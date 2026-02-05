# LMS2 - Compliance & Safety Training Platform

LMS2 is a modern, robust Learning Management System (LMS) designed for delivering and tracking compliance and safety training. Built with the latest web technologies, it offers a seamless experience for both administrators creating content and workers completing their training.

## 🚀 Project Overview

The platform allows organizations to:
- **Create & Manage Courses**: Build potential multi-module courses with rich content.
- **Interactive Learning**: Engage users with lessons and verify knowledge through quizzes.
- **Track Progress**: Monitor enrollment status, completion rates, and quiz scores in real-time.
- **Role-Based Access**: Distinct distinct interfaces and permissions for creating content (Admins) vs. consuming it (Workers).
- **Secure Authentication**: Robust user session management and protection.

## 🛠 Tech Stack

This project leverages a cutting-edge stack focused on performance, type safety, and developer experience.

- **Framework**: [Next.js 16 (App Router)](https://nextjs.org/) - The React Framework for the Web.
- **Language**: [TypeScript](https://www.typescriptlang.org/) - Statically typed JavaScript.
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS framework (implied via `globals.css` and layout).
- **Database**: [PostgreSQL](https://www.postgresql.org/) - Robust relational database system.
- **ORM**: [Prisma](https://www.prisma.io/) - Next-generation Node.js and TypeScript ORM (`v5.22.0`).
- **Authentication**: [NextAuth.js (v5 Beta)](https://authjs.dev/) - Authentication for Next.js.
- **Utilities**:
  - `react-timekeeper` - Time selection components.
  - `recharts` - Data visualization for dashboards.
  - `nodemailer` - Email sending services.
  - `bcryptjs` - Password hashing.

## ⚙️ Prerequisites

Before getting started, ensure you have the following installed:

- **Node.js** (v20 or higher recommended)
- **npm** (comes with Node.js)
- **PostgreSQL** Database instance (Local or Cloud)
- **Cloudflared CLI** (Optional, for using the provided tunnel scripts)

## 📥 Installation & Setup

1.  **Clone the Repository**

    ```bash
    git clone <repository-url>
    cd lms2
    ```

2.  **Install Dependencies**

    ```bash
    npm install
    ```

3.  **Environment Configuration**

    Create a `.env` file in the root directory. You can use the example below as a template:

    ```env
    # Database Connection
    DATABASE_URL="postgresql://user:password@localhost:5432/lms2?schema=public"

    # NextAuth Configuration
    NEXTAUTH_SECRET="your-super-secret-key"
    NEXTAUTH_URL="http://localhost:3000"

    # Email Service (if applicable)
    EMAIL_SERVER_HOST="smtp.example.com"
    EMAIL_SERVER_PORT=587
    EMAIL_SERVER_USER="apikey"
    EMAIL_SERVER_PASSWORD="your-email-password"
    EMAIL_FROM="noreply@theraptly.com"
    ```

4.  **Database Setup**

    Run the Prisma migrations to set up your database schema:

    ```bash
    npx prisma generate
    npx prisma migrate dev --name init
    ```

    Alternatively, to push the schema without creating a migration history (good for rapid prototyping):

    ```bash
    npx prisma db push
    ```

## 📜 Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts the development server at `http://localhost:3000`. |
| `npm run build` | Builds the application for production. |
| `npm run start` | Starts the production server. |
| `npm run lint` | Runs ESLint to check for code quality issues. |
| `./start-tunnel.sh` | Starts the Cloudflare tunnel (requires `cloudflared` config). |

## 📂 Project Structure

A high-level overview of the implementation:

```
lms2/
├── prisma/
│   └── schema.prisma      # Database models and configuration
├── public/                # Static assets (images, icons)
├── src/
│   ├── actions/           # Server Actions for data mutations (User, Staff, Courses)
│   ├── app/               # Next.js App Router pages
│   │   ├── (auth)/        # Authentication routes
│   │   ├── dashboard/     # Main authenticated user interface
│   │   ├── onboarding/    # User setup flows
│   │   ├── api/           # API routes
│   │   └── ...
│   ├── components/        # Reusable UI components
│   │   ├── dashboard/     # Dashboard-specific widgets
│   │   └── ui/            # Generic design system components
│   └── lib/               # Utility functions and shared logic (Email, Auth)
├── cloudflared_config.yml # Configuration for Cloudflare Tunnel
└── start-tunnel.sh        # Script to launch external access
```

## 💎 Features & Key Modules

### Data Models (`prisma/schema.prisma`)
- **User & Profile**: Core identity management with role support (`admin`, `worker`).
- **Course System**: Hierarchical structure of `Course` -> `Lesson` -> `Quiz`.
- **Engagement**: `Enrollment` tracks a user's progress through a course. `QuizAttempt` records scores and pass/fail status.
- **Documents**: System for managing user-uploaded files or resource documents.

### Dashboard
The dashboard (`src/app/dashboard`) is the central hub, adapting to the user's role:
- **Workers**: View assigned courses, continue where they left off, and see completion certificates.
- **Admins**: Manage staff, creating new courses, and view analytics on training effectiveness.

### Cloudflare Tunnel Integration
The project is configured for secure remote access using Cloudflare Tunnel.
- **Config**: `cloudflared_config.yml` maps `lms.theraptly.com` to your local service.
- **Execution**: Run `./start-tunnel.sh` to expose your local dev server securely to the internet.

## 🚀 Deployment

### Standard Deployment (Vercel/Node)
1.  Build the project: `npm run build`
2.  Start the server: `npm start`

### Using Cloudflare Tunnel
For exposing a local instance or a private server:
1.  Ensure `cloudflared` is installed.
2.  Update `cloudflared_config.yml` with your tunnel ID and credentials path.
3.  Run `./start-tunnel.sh`.

---
*Generated for LMS2 Team.*
