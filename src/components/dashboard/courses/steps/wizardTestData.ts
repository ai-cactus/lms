/**
 * Test-only fixture: a complete, valid {@link CourseWizardData}. Shared by the
 * wizard step tests so each one can spread just the fields it exercises without
 * casting away the type — and so a new wizard field is added in one place.
 * Not imported by any runtime code.
 */
import { CourseWizardData } from '@/types/course';

export const WIZARD_FORM_DATA: CourseWizardData = {
  categoryId: 'cat-1',
  title: 'HIPAA Privacy and Security Training',
  description: 'Essential training on the HIPAA Privacy and Security Rules.',
  difficulty: 'moderate',
  duration: '45',
  notesCount: '10',
  completionDeadlineDays: 30,
  objectives: ['Objective one', 'Objective two', 'Objective three'],
  quizTitle: 'HIPAA Privacy and Security Quiz',
  quizQuestionCount: '15',
  quizDifficulty: 'medium',
  quizQuestionType: 'multiple_choice',
  quizDuration: '',
  quizPassMark: '80%',
  quizAttempts: '2',
  assignments: [],
  dueDate: '',
  dueTime: '',
  modules: [],
  assignMode: 'roles',
  assignRoles: [],
  dueDeadlineEnabled: false,
  reminders: [{ value: 7, unit: 'days' }],
  recurringEnabled: false,
  renewalCycle: 'none',
};
