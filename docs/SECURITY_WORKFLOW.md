# 🔒 Security & Development Workflow

## Branch Protection Setup (GitHub)

To enable branch protection on main:

1. Go to: **GitHub → Settings → Branches**
2. Click **Add rule** under "Branch protection rules"
3. Set pattern: `main`
4. Enable:
   - ✅ Require a pull request before merging
   - ✅ Require status checks to pass before merging
   - ✅ Require code reviews before merging (1 reviewer minimum)
   - ✅ Dismiss stale pull request approvals when new commits are pushed
   - ✅ Require branches to be up to date before merging

## Secure Development Workflow

### Step 1: Create Feature Branch
```bash
git checkout -b feature/your-feature-name
# Example: feature/responsive-design
```

### Step 2: Make Changes
Edit files locally and test:
```bash
git add .
git commit -m "Description of changes"
```

### Step 3: Push to Feature Branch
```bash
git push origin feature/your-feature-name
```

### Step 4: Create Pull Request
- Go to GitHub repository
- Click "New Pull Request"
- Select your feature branch
- Add description of changes
- Click "Create Pull Request"

### Step 5: Review & Test
- Vercel creates preview deployment automatically
- Test changes at preview URL
- Review code for security issues
- Get approval from team member

### Step 6: Merge to Main
- Click "Merge pull request"
- Vercel auto-deploys to production
- Delete feature branch

## Security Checklist

Before pushing any code:

- [ ] No API keys or secrets in code
- [ ] No `.env` files committed
- [ ] No passwords or tokens
- [ ] HTML/CSS syntax valid
- [ ] No console errors
- [ ] Mobile responsive tested
- [ ] No breaking changes
- [ ] Comments added for complex logic

## Environment Variables

### Never commit:
- Firebase API keys
- Database credentials
- User tokens
- Payment API keys
- Admin credentials

### Store in:
- `.env.local` (local only)
- GitHub Secrets (for CI/CD)
- Vercel Environment Variables

## Git Best Practices

### Commit Messages
```
Good:   "Add responsive design to login page"
Bad:    "fix"
Better: "Fix password toggle icon state for mobile"
```

### Branch Naming
```
feature/add-dark-mode
fix/password-toggle-bug
docs/update-readme
refactor/cleanup-css
```

### Before Pushing
```bash
git status          # Check what's changed
git diff            # Review changes
git log -1          # See your commit
```

## Troubleshooting

### Pushed wrong code?
```bash
git revert HEAD~1   # Revert last commit
git push origin main
```

### Need to undo local changes?
```bash
git reset --hard HEAD
```

### Merge conflict?
```bash
git pull origin main
# Resolve conflicts manually
git add .
git commit -m "Resolve merge conflicts"
git push origin feature-branch
```

## Auto-Deploy Settings (Vercel)

Current setup:
- ✅ Auto-deploy on push to `main`
- ✅ Preview deployment on PR
- ⏱️ Deploy time: 30-60 seconds

Monitor at: https://vercel.com/dashboard

## Security Monitoring

- GitHub: Check security alerts in repository
- Vercel: Monitor for deployment errors
- Monitor logs for suspicious activity

---

**Remember:** This workflow prevents broken code from going live! 🚀
