
import { sendInviteEmail, sendCourseEnrollmentEmail } from '../src/lib/email';
async function testEmail() {
    const email = 'nopermx00@gmail.com';
    console.log(`Testing email sending to ${email}...`);

    try {
        console.log('1. Testing Invite Email...');
        const inviteResult = await sendInviteEmail(
            email,
            'https://staging-lms.theraptly.com/invite/test-token',
            'Test Organization',
            'Worker'
        );
        console.log('Invite Email Result:', inviteResult);
    } catch (error) {
        console.error('Invite Email Failed:', error);
    }

    try {
        console.log('2. Testing Enrollment Email...');
        const enrollmentResult = await sendCourseEnrollmentEmail(
            email,
            'Test User',
            'Test Course: HIPAA Compliance',
            'Test Organization'
        );
        console.log('Enrollment Email Result:', enrollmentResult);
    } catch (error) {
        console.error('Enrollment Email Failed:', error);
    }
}

testEmail();
