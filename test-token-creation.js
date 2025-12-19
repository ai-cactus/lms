// Test auto-login token creation directly
const { generateAutoLoginToken, storeAutoLoginToken } = require('./src/lib/auto-login-tokens.ts');

async function testTokenCreation() {
    console.log('🔍 Testing auto-login token creation...\n');

    try {
        // Generate a test token
        const testUserId = 'ca0846b5-b57f-4733-8c52-a8c456e2c0b0'; // Use an existing user ID
        const testEmail = 'test@example.com';
        const testRedirect = '/worker/courses';

        console.log('Generating token...');
        const tokenData = generateAutoLoginToken(testUserId, testEmail, undefined, testRedirect);

        console.log('Token generated:', {
            token: tokenData.token.substring(0, 20) + '...',
            userId: tokenData.userId,
            email: tokenData.email,
            redirectTo: tokenData.redirectTo,
            expiresAt: tokenData.expiresAt
        });

        // Try to store it
        console.log('Storing token...');
        const result = await storeAutoLoginToken(tokenData);

        console.log('Storage result:', result);

        if (result.success) {
            console.log('✅ Token creation test PASSED');
        } else {
            console.log('❌ Token creation test FAILED:', result.error);
        }

    } catch (error) {
        console.error('❌ Exception during token creation test:', error);
    }
}

testTokenCreation();
