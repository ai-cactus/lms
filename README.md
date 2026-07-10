# LMS - AI-Powered Compliance & Safety Training Platform

LMS is a sophisticated, enterprise-ready Learning Management System (LMS) designed to automate and streamline compliance and safety training. It leverages a state-of-the-art AI pipeline to transform raw documents into interactive, high-quality learning experiences.

---

## 🏗 Architecture Overview

LMS is built on a modern, scalable stack:

- **Frontend**: Next.js 16 (App Router) for a performant, SEO-friendly user experience.
- **Backend**: Next.js Server Actions and API Routes for robust business logic.
- **Database**: PostgreSQL with Prisma ORM for type-safe data management.
- **AI Pipeline (v4.6)**: Multi-stage orchestration using Google Vertex AI and Gemini for content generation and validation.
- **Authentication**: Isolated sessions for different roles (`admin` vs `worker`) using NextAuth.v5.
- **Infrastructure**: Deployment-ready scripts for staging and production, including PM2 and Cloudflare Tunnel support.

---

## ✨ Features

- **Multi-Tenant Org Management**: Complete isolation between different organizations.
- **AI-Driven Course Authoring**: Generate rich articles, slides, and quizzes from PDF, DOCX, and XLSX files.
- **Global Video Courses**: System admins upload self-hosted video courses with a quiz (CSV/JSON) in the back office; every organization can assign them. Course details, the video, and the quiz file can all be updated later from the edit page.
- **PHI Scanning**: Automatic detection of Protected Health Information in uploaded documents.
- **Interactive Learning**: Slide decks, quizzes with archetypes, and real-time progress tracking.
- **Compliance Reporting**: Automated generation of evidence packs for auditors (e.g., CARF compliance).
- **Secure Attestations**: Cryptographically logged digital signatures for course completions.

---

## 🚀 Getting Started

### 📋 Prerequisites

- **Node.js**: v20 or later
- **Postgres**: v14 or later
- **Google Cloud Platform**: Active project with Vertex AI API enabled (for AI features).

### 📥 Installation

```bash
# Clone the repository
git clone https://github.com/theraptly/lms.git
cd lms

# Install dependencies
npm install
```

### ⚙️ Configuration

Copy the template and fill in your credentials:

```bash
cp .env.example .env
```

Refer to [.env.example](.env.example) for detailed descriptions of each required variable for the project

### 🗄 Database Setup

```bash
# Generate Prisma Client
npx prisma generate

# Synchronize schema (Development)
npx prisma db push

# (Optional) Seed the database with sample courses
npm run script .env.local seed-courses.ts
```

### 🧰 Running scripts

Standalone scripts in `scripts/` are TypeScript, run with `tsx`, and read
`process.env` directly (no dotenv). Run any of them with `npm run script`,
passing the env file for the environment you're targeting and the script name:

```bash
npm run script <env-file|staging|production> <script-file> [-- args]

npm run script .env.local test-db.ts                       # local: sources the env file, runs tsx
npm run script -- .env.local backfill-roles.ts --dry-run   # extra flags need the --
npm run script staging backfill-roles.ts                   # on the staging server
npm run script production backfill-roles.ts                # on the production server
```

With an env file as the first argument, its variables are exported into the
script's environment and the script runs on the host. With `staging` or
`production`, the script runs **inside the app container** via
`docker compose -f docker-compose.<env>.yml exec app npx tsx …` — required on
those servers because the database hostname (`db`) only resolves inside the
compose network, and the container's environment is already loaded from the
server's `.env.staging` / `.env.production`. Note the container runs the
deployed image, so scripts execute at the deployed version, and env-file edits
on the server need `docker compose up -d app` to take effect.

Double-check which environment you passed before running a destructive script.

---

## 📜 Available Scripts

| Command                  | Purpose                                           |
| :----------------------- | :------------------------------------------------ |
| `npm run dev`            | Starts the development server with hot-reloading. |
| `npm run build`          | Compiles the application for production.          |
| `npm run start`          | Launches the production server.                   |
| `npm run lint`           | Checks for code quality and style violations.     |
| `./deploy-production.sh` | Automated production deployment script.           |

---

## 🤝 Contributing

As a team member, you can find detailed instructions on how to contribute and the current status of the project in the [CONTRIBUTING.md](CONTRIBUTING.md) file. We welcome contributions and appreciate your effort to improve our codebase. Please ensure you adhere to our guidelines when making changes.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

_Built with much ❤️ by the Theraptly Team._

