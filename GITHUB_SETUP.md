# GitHub Repository Setup Guide

## Step 1: Create Repository on GitHub

1. Go to [github.com](https://github.com) and sign in
2. Click the **"+"** icon in the top right corner
3. Select **"New repository"**
4. Fill in the details:
   - **Repository name**: `hl-tg-web` (or your preferred name)
   - **Description**: `Telegram-first Hyperliquid trading app with builder code enforcement`
   - **Visibility**: Choose **Public** or **Private**
   - **DO NOT** initialize with README, .gitignore, or license (we already have these)
5. Click **"Create repository"**

## Step 2: Initialize Git in Your Project

Open a terminal in your project directory and run:

```bash
# Initialize git repository
git init

# Add all files to staging
git add .

# Create initial commit
git commit -m "Initial commit: Telegram-first Hyperliquid trading app

- Monorepo structure with Turborepo
- Telegram Mini App with bottom navigation
- Shared UI components (Chart, Orderbook, OrderForm, etc.)
- Hyperliquid SDK wrapper with builder code enforcement
- WebSocket support for real-time data
- Privy wallet integration
- Testnet/Mainnet toggle
- Vercel deployment configuration"

# Add remote repository (replace with your actual URL)
git remote add origin https://github.com/YOUR_USERNAME/hl-tg-web.git

# Push to GitHub
git branch -M main
git push -u origin main
```

## Step 3: Verify Repository

1. Go to your repository URL: `https://github.com/YOUR_USERNAME/hl-tg-web`
2. Verify all files are uploaded
3. Check that `.env` is NOT in the repository (it should be ignored)

## Step 4: Set Up Repository Secrets (for Vercel)

If you want to deploy via GitHub Actions:

1. Go to your repository on GitHub
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Add the following secrets:
   - `VERCEL_TOKEN`: Your Vercel token (get from [vercel.com/account/tokens](https://vercel.com/account/tokens))
   - `VERCEL_ORG_ID`: Your Vercel organization ID
   - `VERCEL_PROJECT_ID`: Your Vercel project ID

## Step 5: Set Up Branch Protection (Optional)

1. Go to **Settings** → **Branches**
2. Click **"Add rule"**
3. Branch name pattern: `main`
4. Enable:
   - ✅ Require a pull request before merging
   - ✅ Require status checks to pass before merging
5. Click **"Create"**

## Step 6: Add Collaborators (Optional)

1. Go to **Settings** → **Collaborators**
2. Click **"Add people"**
3. Enter GitHub username or email
4. Select role (Read, Write, or Admin)
5. Click **"Add to repository"**

## Step 7: Create Development Branch

```bash
# Create and switch to development branch
git checkout -b development

# Push development branch
git push -u origin development
```

## Step 8: Set Up GitHub Actions (Optional)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Vercel

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install pnpm
        run: npm install -g pnpm
      
      - name: Install dependencies
        run: pnpm install
      
      - name: Build
        run: pnpm build
      
      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v20
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
```

## Quick Reference Commands

```bash
# Check status
git status

# Add changes
git add .

# Commit changes
git commit -m "Your commit message"

# Push to GitHub
git push

# Pull latest changes
git pull

# Create new branch
git checkout -b feature/your-feature

# Switch branches
git checkout main
git checkout development

# Merge branch
git checkout main
git merge development
```

## Repository Structure

```
hl-tg-web/
├── .github/              # GitHub Actions workflows
├── apps/
│   ├── tg-mini-app/      # Telegram Mini App
│   └── web/              # Desktop webapp
├── packages/
│   ├── ui/               # Shared UI components
│   ├── hyperliquid-sdk/  # SDK wrapper
│   ├── types/            # TypeScript types
│   └── config/           # Shared configs
├── plans/                # Implementation plans
├── .env.example          # Environment template
├── .gitignore            # Git ignore rules
├── DEPLOYMENT.md         # Deployment guide
├── GITHUB_SETUP.md       # This file
├── README.md             # Project documentation
├── package.json          # Root package.json
├── pnpm-workspace.yaml   # pnpm workspace config
└── turbo.json            # Turborepo config
```

## Next Steps

1. ✅ Create repository on GitHub
2. ✅ Push code to GitHub
3. ✅ Set up Vercel integration
4. ✅ Configure Telegram Bot
5. ✅ Deploy and test

## Troubleshooting

### Push rejected
```bash
# Force push (use with caution)
git push -f origin main
```

### Large files
```bash
# Check for large files
find . -type f -size +100M

# Add to .gitignore if needed
echo "large-file.zip" >> .gitignore
```

### Merge conflicts
```bash
# Pull latest changes
git pull origin main

# Resolve conflicts manually
# Then commit
git add .
git commit -m "Resolve merge conflicts"
```
