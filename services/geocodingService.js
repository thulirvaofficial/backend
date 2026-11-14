const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "AIzaSyDqhJ1XV_YMFmlEAGYkBxnHhNPCnjGhO8U";

// Known geographical coordinates across Chennai and Tamil Nadu
const KNOWN_AREAS = [
    { keys: ["thiruverkadu", "thiruverkkadu", "tiruvekadu", "600077"], lat: 13.0694, lng: 80.1247, area: "Thiruverkadu", city: "Chennai" },
    { keys: ["valasaravakkam", "valasarawakkam", "alwarthirunagar", "600087"], lat: 13.0403, lng: 80.1723, area: "Valasaravakkam", city: "Chennai" },
    { keys: ["porur", "ramapuram", "600116"], lat: 13.0382, lng: 80.1565, area: "Porur", city: "Chennai" },
    { keys: ["kk nagar", "k.k. nagar", "ashok nagar", "600078"], lat: 13.0410, lng: 80.1994, area: "KK Nagar", city: "Chennai" },
    { keys: ["padur", "kelambakkam", "chemmany", "603103"], lat: 12.8025, lng: 80.2233, area: "Padur", city: "Chennai" },
    { keys: ["velachery", "600042"], lat: 12.9815, lng: 80.2180, area: "Velachery", city: "Chennai" },
    { keys: ["anna nagar", "600040"], lat: 13.0850, lng: 80.2101, area: "Anna Nagar", city: "Chennai" },
    { keys: ["t nagar", "t. nagar", "thyagaraya nagar", "600017"], lat: 13.0418, lng: 80.2341, area: "T Nagar", city: "Chennai" },
    { keys: ["adyar", "600020"], lat: 13.0012, lng: 80.2565, area: "Adyar", city: "Chennai" },
    { keys: ["mylapore", "600004"], lat: 13.0368, lng: 80.2676, area: "Mylapore", city: "Chennai" },
    { keys: ["tambaram", "600045"], lat: 12.9249, lng: 80.1000, area: "Tambaram", city: "Chennai" },
    { keys: ["guindy", "600032"], lat: 13.0067, lng: 80.2025, area: "Guindy", city: "Chennai" },
    { keys: ["pondicherry", "puducherry", "605001"], lat: 11.9416, lng: 79.8083, area: "Pondicherry", city: "Puducherry" }
];

/**
 * Geocode an address/city/pincode to genuine GPS coordinates.
 * Never fabricates or returns Padur for non-Padur addresses.
 */
async function geocodeAddress({ address = "", city = "", pincode = "" }) {
    const rawText = `${address} ${city} ${pincode}`.toLowerCase();

    // 1. Fast match on known Chennai areas
    for (const item of KNOWN_AREAS) {
        if (item.keys.some(k => rawText.includes(k))) {
            return {
                latitude: item.lat,
                longitude: item.lng,
                area: item.area,
                city: item.city,
                source: "exact_area_match"
            };
        }
    }

    // 2. Try Google Maps Geocoding API if key is present
    if (GOOGLE_MAPS_API_KEY && GOOGLE_MAPS_API_KEY !== "PLACEHOLDER_KEY") {
        try {
            const query = [address, city, pincode, "India"].filter(Boolean).join(", ");
            const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&components=country:in&key=${GOOGLE_MAPS_API_KEY}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
            const data = await res.json();
            if (data && data.results && data.results.length > 0) {
                const loc = data.results[0].geometry.location;
                return {
                    latitude: loc.lat,
                    longitude: loc.lng,
                    area: city || "Chennai",
                    city: city || "Chennai",
                    source: "google_geocoding"
                };
            }
        } catch (_) {}
    }

    // 3. Try Nominatim (OpenStreetMap) fallback
    try {
        const query = [address, city, pincode].filter(Boolean).join(", ");
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
        const res = await fetch(url, {
            headers: { "User-Agent": "ThulirvaGeocoding/1.0" },
            signal: AbortSignal.timeout(3500)
        });
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            return {
                latitude: parseFloat(data[0].lat),
                longitude: parseFloat(data[0].lon),
                area: city || "Chennai",
                city: city || "Chennai",
                source: "nominatim"
            };
        }
    } catch (_) {}

    // 4. Default: Chennai center (13.0827, 80.2707) - NEVER default to Padur
    return {
        latitude: 13.0827,
        longitude: 80.2707,
        area: "Chennai Center",
        city: "Chennai",
        source: "city_center_fallback"
    };
}

module.exports = {
    geocodeAddress,
    KNOWN_AREAS
};

