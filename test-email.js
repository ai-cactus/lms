// Test script to send an email
const nodemailer = require('nodemailer');
require('dotenv').config();

const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASSWORD;
const host = process.env.SMTP_HOST || 'smtp.zoho.com';
const port = parseInt(process.env.SMTP_PORT || '587');

console.log('SMTP Config:', { host, port, user: user ? '***' : 'missing' });

const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // false for 587
    auth: {
        user,
        pass
    }
});

async function sendTestEmail() {
    try {
        console.log('Sending test email...');
        const info = await transporter.sendMail({
            from: `"Theraptly LMS Test" <${user}>`,
            to: 'praiseomosanya250@gmail.com',
            subject: 'Test Email from Theraptly LMS',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #4C6EF5;">🎉 Email Test Successful!</h2>
                    <p>This is a test email from your Theraptly LMS application.</p>
                    <p>If you're receiving this, your Zoho SMTP configuration is working correctly!</p>
                    <p style="margin-top: 24px; font-size: 12px; color: #718096;">Sent at: ${new Date().toISOString()}</p>
                </div>
            `,
        });
        console.log('✅ Email sent successfully!');
        console.log('Message ID:', info.messageId);
    } catch (error) {
        console.error('❌ Error sending email:', error);
    }
}

sendTestEmail();
