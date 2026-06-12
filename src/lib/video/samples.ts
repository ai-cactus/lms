export const SAMPLE_QUIZ_CSV = `question,option_a,option_b,option_c,option_d,correct_answer,explanation
What does PHI stand for?,Protected Health Information,Private Hospital Index,Patient Health Insurance,Public Health Initiative,A,PHI = Protected Health Information.
Which is an administrative safeguard?,Firewall,Workforce training,Door locks,Encryption,B,Administrative safeguards include workforce training.
How soon must a breach be reported?,Never,Within 60 days,After 1 year,Only if asked,B,HIPAA requires breach notification within 60 days.
`;

export const SAMPLE_QUIZ_JSON = JSON.stringify(
  {
    passingScore: 80,
    allowedAttempts: 2,
    questions: [
      {
        text: 'What does PHI stand for?',
        options: [
          'Protected Health Information',
          'Private Hospital Index',
          'Patient Health Insurance',
        ],
        correctAnswer: 'Protected Health Information',
        explanation: 'PHI = Protected Health Information.',
      },
      {
        text: 'Which is an administrative safeguard?',
        options: ['Firewall', 'Workforce training', 'Door locks'],
        correctAnswer: 'Workforce training',
        explanation: 'Administrative safeguards include workforce training.',
      },
    ],
  },
  null,
  2,
);
