import { OAuth2Client } from 'google-auth-library';

const client = new OAuth2Client(process.env.GOOGLE_OAUTH_CLIENT_ID);

export async function verifyGoogleToken(accessToken: string) {
    try {
        const ticket = await client.getTokenInfo(accessToken);
        return ticket;
    } catch (error) {
        throw new Error('Google token verification failed');
    }
}