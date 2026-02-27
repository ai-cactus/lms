# LMS2 - AI-Powered Compliance & Safety Training Platform

LMS2 is a cutting-edge Learning Management System (LMS) designed for delivering, tracking, and automating compliance and safety training. Built with modern web technologies, it features an advanced AI pipeline (v4.6) for generating course content and quizzes directly from documents and specifications.

## 🚀 Project Overview

The platform serves distinct user roles with specific workflows:
- **Workers**: Engage with assigned courses, take interactive quizzes, and provide completion attestations.
- **Admin/Staff**: Manage organization settings, invite users, and leverage AI to generate complex training materials based on uploaded documents.

### ✨ Key Features
- **Org & User Management**: Multi-tenant architecture with `Organization` models. Secure invites and robust role-based access (`admin` vs `worker`).
- **AI-Powered Course Generation (v4.6 Pipeline)**: Uses Google Vertex AI & Generative AI to automatically generate courses. The 5-stage pipeline creates article metadata, rich markdown articles, interactive slide decks, and comprehensive quizzes with AI judging.
- **Document & PHI Management**: Securely upload documents (PDF, Word, Excel) with built-in PHI (Protected Health Information) scanning and entity detection.
- **Interactive Quizzes**: Time limits, passing scores, multiple question types, and evidence-based explanations (archetypes like sequence, escalation, modality-check).
- **Compliance Tracking & Attestations**: Real-time progress monitoring, quiz attempt tracking, and cryptographically secure digital signatures for attestations.
- **Auditor Evidence Pack**: Generate automated packages linking training materials directly to compliance standards (e.g., CARF).

## 🛠 Tech Stack

- **Framework**: [Next.js 16 (App Router)](https://nextjs.org/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) & [Framer Motion](https://www.framer.com/motion/)
- **Database**: [PostgreSQL](https://www.postgresql.org/)
- **ORM**: [Prisma](https://www.prisma.io/) (`v5.22.0`)
- **Authentication**: [NextAuth.js (v5 Beta)](https://authjs.dev/) & [Bcryptjs](https://www.npmjs.com/package/bcryptjs)
- **AI/ML**: `@google-cloud/vertexai`, `@google/generative-ai`
- **Document Processing**: `pdf-parse`, `react-pdf`, `mammoth` (DOCX), `xlsx`
- **Rich Text**: `quill`, `react-quill`
- **Analytics/Vis**: `recharts`
- **Time/Dates**: `react-timekeeper`

## 📂 Project Structure

A high-level overview:
```
lms2/
├── prisma/
│   └── schema.prisma      # DB schema, incl. Organization, Course, Document, Quiz, etc.
├── src/
│   ├── actions/           # Server Actions (Auth, AI Generation, Document upload)
│   ├── app/               # Next.js App Router (/(auth), /dashboard, /onboarding, /worker)
│   ├── api/               # API endpoints
│   ├── components/        # Reusable UI components and feature widgets
│   └── lib/               # Shared utilities (AI orchestration, PDF processing)
├── scripts/               # Utility scripts
├── public/                # Static assets (images, icons)
└── deploy-*.sh            # Deployment scripts (Staging, Production)
```

## ⚙️ Prerequisites

- **Node.js** (v20+)
- **PostgreSQL** Database
- **Cloudflared CLI** (Optional, for remote access)
- **PM2** (For production deployment management)

## 📥 Installation & Setup

1. **Clone & Install**
   ```bash
   git clone <repository-url>
   cd lms2
   npm install
   ```

2. **Environment Configuration**
   Create a `.env` file based on the following template:
   ```env
   # Database Connection
   DATABASE_URL="postgresql://user:password@localhost:5432/lms2?schema=public"

   # NextAuth Configuration
   NEXTAUTH_SECRET="your-super-secret-key"
   NEXTAUTH_URL="http://localhost:3000"

   # Email Service
   EMAIL_SERVER_HOST="smtp.example.com"
   EMAIL_SERVER_PORT=587
   EMAIL_SERVER_USER="apikey"
   EMAIL_SERVER_PASSWORD="your-email-password"
   EMAIL_FROM="noreply@theraptly.com"
   ```

3. **Database Setup**
   Run Prisma migrations or push the schema to set up your database:
   ```bash
   npx prisma generate
   npx prisma db push
   # or npx prisma migrate dev --name init
   ```

## 📜 Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts the development server at `http://localhost:3000`. |
| `npm run build` | Builds the application for production. |
| `npm run start` | Starts the production server. |
| `npm run lint` | Runs ESLint to check for code quality issues. |
| `./start-tunnel.sh` | Starts the Cloudflare tunnel (requires `cloudflared` config). |
| `./deploy-staging.sh` | Deploys the application to the staging environment. |
| `./deploy-production.sh`| Deploys the application to the production environment. |

## 🚀 Deployment

The project includes bash scripts to streamline deployments across different environments (Staging/Production). Process management is handled with **PM2** via `ecosystem.config.js`.

- Use `deploy-staging.sh` and `deploy-production.sh` to pull updates, install dependencies, build the Next.js app, and restart PM2.
- For local tunneling and quick remote access, the `cloudflared` configurations and `start-tunnel.sh` allow securely exposing `localhost:3000`.

---
*Generated for LMS2 Team.*
