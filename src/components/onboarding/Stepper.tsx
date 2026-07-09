import React from 'react';
import { Check } from 'lucide-react';

const steps = [
  { id: 1, label: 'Org. details' },
  { id: 2, label: 'Credentialing' },
  { id: 3, label: 'Services' },
  { id: 4, label: 'Invite Team Members' },
  { id: 5, label: 'Invite Workers' },
];

interface StepperProps {
  currentStep: number;
}

export default function Stepper({ currentStep }: StepperProps) {
  return (
    <div className="relative mx-auto mb-8 flex max-w-[700px] md:mb-[60px]">
      <div
        className="absolute top-4 z-0 h-0.5 -translate-y-1/2 bg-background-secondary"
        style={{
          left: `${100 / (steps.length * 2)}%`,
          right: `${100 / (steps.length * 2)}%`,
        }}
      >
        <div
          className="h-full bg-primary transition-[width] duration-300 ease-in-out"
          style={{
            width: `${((currentStep - 1) / (steps.length - 1)) * 100}%`,
          }}
        />
      </div>

      {steps.map((step) => {
        const isActive = step.id === currentStep;
        const isCompleted = step.id < currentStep;
        const isHighlighted = isActive || isCompleted;

        return (
          <div key={step.id} className="relative z-[1] flex flex-1 flex-col items-center gap-2">
            <div
              className={`flex size-8 items-center justify-center rounded-full border text-sm font-semibold shadow-[0_0_0_6px_var(--background-secondary)] ${
                isHighlighted
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-text-tertiary'
              } ${isActive ? 'shadow-[0_0_0_6px_var(--background-secondary),0_0_0_10px_rgba(76,110,245,0.1)]' : ''}`}
            >
              {isCompleted ? (
                <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
              ) : (
                step.id
              )}
            </div>
            <span
              className={`mt-1 hidden text-[11px] font-medium capitalize md:block ${
                isHighlighted ? 'text-primary' : 'text-text-tertiary'
              }`}
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
