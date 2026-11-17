const { pool } = require('../config/database');
const { initiateSmartDispatch } = require('../services/dispatchEngine');

async function testDispatch() {
    const orderNum = 'THU-' + Date.now().toString().slice(-8);
    const orderData = {
        order_number: orderNum,
        customer_name: 'Ananya S (Real Customer)',
        customer_phone: '9840123456',
        items: JSON.stringify([
            { id: 1, name: 'Country Chicken Eggs (Country Hen)', quantity: 2, price: 100 },
            { id: 2, name: 'Organic Cold-Pressed Sesame Oil (500ml)', quantity: 1, price: 180 }
        ]),
        total: 380,
        subtotal: 380,
        delivery_fee: 0,
        payment_method: 'Online UPI',
        payment_status: 'paid',
        order_status: 'placed',
        address: 'Flat 4B, Green Valley Apts, Mount-Poonamallee High Rd',
        city: 'Valasaravakkam',
        landmark: 'Near Valasaravakkam Water Tank',
        pincode: '600087',
        latitude: 13.0402,
        longitude: 80.1723,
        delivery_instructions: 'Ring doorbell twice. Leave package at doorstep.'
    };

    const res = await pool.query(
        `INSERT INTO orders (order_number, customer_name, customer_phone, items, total, subtotal, delivery_fee, payment_method, payment_status, order_status, address, city, landmark, pincode, latitude, longitude, delivery_instructions, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW())
         RETURNING id, order_number`,
        [
            orderData.order_number, orderData.customer_name, orderData.customer_phone,
            orderData.items, orderData.total, orderData.subtotal, orderData.delivery_fee,
            orderData.payment_method, orderData.payment_status, orderData.order_status,
            orderData.address, orderData.city, orderData.landmark, orderData.pincode,
            orderData.latitude, orderData.longitude, orderData.delivery_instructions
        ]
    );

    const newOrder = res.rows[0];
    console.log(`✓ Created Order #${newOrder.id} (${newOrder.order_number})`);

    const dispatchResult = await initiateSmartDispatch(newOrder.id);
    console.log('✓ Smart Dispatch Result:', JSON.stringify(dispatchResult, null, 2));
    process.exit(0);
}

testDispatch().catch(err => {
    console.error('Dispatch Test Error:', err);
    process.exit(1);
});

