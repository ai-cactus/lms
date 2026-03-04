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

Refer to [.env.example](.env.example) for detailed descriptions of each required variable.

### 🗄 Database Setup

```bash
# Generate Prisma Client
npx prisma generate

# Synchronize schema (Development)
npx prisma db push

# (Optional) Seed the database with sample courses
node scripts/seed-courses.js
```

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

## 🤝 Contribution

We welcome contributions! Please see our [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to get started.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

_Built with ❤️ by the Theraptly Team._
