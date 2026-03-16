# Security Policy

## API Keys & Credentials

### ⚠️ NEVER Commit Sensitive Information

- API Keys
- Firebase credentials
- Database passwords
- Authentication tokens
- Private encryption keys

### How Environment Variables Are Handled

This project uses environment variables for sensitive configuration:

1. **Local Development**
   - Copy `.env.example` to `.env.local`
   - Add your API keys to `.env.local`
   - `.env.local` is listed in `.gitignore` - it will never be committed

2. **Vercel Deployment**
   - Go to: https://vercel.com/dashboard
   - Select your project
   - Go to: Settings > Environment Variables
   - Add each variable from `.env.example`
   - Vercel automatically injects them at build time

3. **Build Process**
   - `build.sh` script substitutes `__FIREBASE_API_KEY__` placeholders
   - Only after environment variables are injected

### Files Containing Sensitive Data

The following files contain placeholders for environment variables:
- `pages/admin/dashboard.html` - `__FIREBASE_API_KEY__` placeholder
- `login.html` - `__FIREBASE_API_KEY__` placeholder

These placeholders are replaced during build time with actual values from environment variables.

### GitHub Secret Scanning

If a credential is accidentally exposed:

1. **Immediately revoke the credential**
   - Go to Google Cloud Console or Firebase Console
   - Regenerate the API key
   - Delete the old key

2. **Force-push the fix** (⚠️ Use with caution)
   ```bash
   git push --force origin main
   ```

3. **Run GitHub secret scanning**
   - Go to: Settings > Security > Secret scanning
   - Verify that the old secret is no longer in history

### Best Practices

✅ **DO:**
- Use `.env.local` for development
- Use Vercel environment variables for production
- Rotate credentials regularly
- Use restrictive API key permissions
- Enable IP whitelisting on API keys

❌ **DON'T:**
- Commit `.env` files
- Hardcode API keys in source code
- Share credentials in chat or email
- Use the same key across environments
- Use root/admin credentials in client-side code

### Firebase Security Rules

Ensure your Firebase Database and Storage have proper security rules:

```javascript
// ❌ BAD - Anyone can read/write
{
  "rules": {
    ".read": true,
    ".write": true
  }
}

// ✅ GOOD - Only authenticated users
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}
```

## Reporting Security Issues

If you discover a security vulnerability, please email security@example.com instead of using the issue tracker.

Do not publicly disclose the vulnerability until it has been fixed.
