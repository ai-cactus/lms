# Contributing to LMS

Thank you for your interest in contributing to LMS! We welcome contributions from the community to help make this AI-powered learning management system even better.

## 🤝 Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct. We expect all contributors to maintain a respectful and inclusive environment.

## 🛠 Development Workflow

1.  **Fork the Repository**: Create a personal fork on GitHub.
2.  **Clone Locally**: `git clone https://github.com/your-username/lms.git`
3.  **Create a Branch**: Use descriptive names like `feature/new-ai-pipeline` or `bugfix/auth-redirect`.
4.  **Install Dependencies**: `npm install`
5.  **Make Changes**: Ensure your code follows our style guidelines.
6.  **Run Linting**: `npm run lint`
7.  **Submit a Pull Request**: Provide a clear description of your changes and link any relevant issues.

### 🔁 Workflow Breakdown

1. **Pull latest dev**

```bash
git checkout dev
git pull origin dev
```

2. **Create feature branch**

```bash
git checkout -b feature/auth-refactor
```

3. **Make changes**

4. **Push branch**
```bash
git push origin feature/auth-refactor
```

5. **Create PR:**

- `Base branch → dev`

- `Compare branch → feature/auth-refactor`

6. **Get review → Merge into dev**

## 📜 Coding Standards

- **TypeScript**: Use strict typing where possible. Avoid `any`.
- **Next.js**: Follow App Router conventions.
- **Prisma**: Ensure all schema changes are backed by migrations or documented push steps.
- **Styling**: Use Vanila CSS and follow the existing design system.
- **Logging**: Use the centralized logger in `src/lib/logger.ts`.

## 🐛 Bug Reports & Feature Requests

- Use GitHub Issues to report bugs or suggest new features.
- Provide as much detail as possible, including steps to reproduce bugs or clear use cases for features.

## 🚀 Pull Request Process

1.  Keep PRs focused on a single change.
2.  Update documentation if your changes affect external behavior or setup.
3.  Wait for a maintainer to review and approve your PR.

---

_Questions? Reach out to the maintainers or open an issue._
