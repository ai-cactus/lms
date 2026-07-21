/**
 * Regression tests for making the dashboard profile page's Facility tab
 * fully read-only: every field (including the phone input and program-service
 * checkboxes) is permanently disabled, the Save Changes / Discard / Upload
 * (Replace) Document controls were removed, while an existing compliance
 * document still renders its name + View link and the "No Facility Found"
 * empty state is preserved.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import FacilityForm from './FacilityForm';

const baseFacility = {
  id: 'fac-1',
  name: 'Main Clinic',
  staffCount: '11-49',
  phone: '+1 (555) 123-4567',
  address: '123 Main St',
  country: 'US',
  state: 'CA',
  zipCode: '90210',
  city: 'Beverly Hills',
  licenseNumber: 'LIC-9999',
  programServices: ['behavioral', 'vision'],
  complianceDocumentUrl: 'https://storage.example.com/doc.pdf',
  complianceDocumentName: 'HIPAA-Certificate.pdf',
  complianceDocumentDisplayUrl: 'https://signed.example.com/doc.pdf',
};

describe('FacilityForm — read-only fields', () => {
  it('renders text field values pre-filled from initialData and disabled', () => {
    render(<FacilityForm initialData={baseFacility} />);

    const textFields = [
      screen.getByDisplayValue('123 Main St'),
      screen.getByDisplayValue('90210'),
      screen.getByDisplayValue('Beverly Hills'),
      screen.getByDisplayValue('LIC-9999'),
    ];
    textFields.forEach((field) => expect(field).toBeDisabled());
  });

  it('renders select values pre-filled from initialData and disabled', () => {
    render(<FacilityForm initialData={baseFacility} />);

    const comboboxes = screen.getAllByRole('combobox');
    expect(comboboxes).toHaveLength(3); // staff count, country, state
    comboboxes.forEach((box) => expect(box).toBeDisabled());

    expect(screen.getByText('11-49')).toBeInTheDocument();
    expect(screen.getByText('United States')).toBeInTheDocument();
    expect(screen.getByText('California')).toBeInTheDocument();
  });

  it('renders the phone input pre-filled and disabled', () => {
    render(<FacilityForm initialData={baseFacility} />);

    const phoneInput = screen.getByDisplayValue('+1 (555) 123-4567');
    expect(phoneInput).toBeDisabled();

    // The country-selector button is the only <button> left in a fully read-only form.
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders program-services checkboxes reflecting saved state, all disabled', () => {
    render(<FacilityForm initialData={baseFacility} />);

    expect(screen.getByLabelText('Behavioral Health')).toBeChecked();
    expect(screen.getByLabelText('Vision Rehabilitation Services')).toBeChecked();
    expect(screen.getByLabelText('Aging Services')).not.toBeChecked();
    expect(screen.getByLabelText('Child & Youth Services')).not.toBeChecked();

    for (const label of [
      'Aging Services',
      'Behavioral Health',
      'Child & Youth Services',
      'Employment & Community Services',
      'Medical Rehabilitation',
      'Opioid Treatment Program',
      'Vision Rehabilitation Services',
    ]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
  });

  it('renders no Save Changes / Discard / Upload / Replace Document buttons', () => {
    render(<FacilityForm initialData={baseFacility} />);

    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^discard$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /replace document/i })).not.toBeInTheDocument();
  });
});

describe('FacilityForm — compliance document display', () => {
  it('renders the document name and a View link pointing at the signed display URL when present', () => {
    render(<FacilityForm initialData={baseFacility} />);

    expect(screen.getByText('HIPAA-Certificate.pdf')).toBeInTheDocument();
    const viewLink = screen.getByRole('link', { name: /view/i });
    expect(viewLink).toHaveAttribute('href', 'https://signed.example.com/doc.pdf');
    expect(viewLink).toHaveAttribute('target', '_blank');
  });

  it('omits the document name and View link when no compliance document exists', () => {
    render(
      <FacilityForm
        initialData={{
          ...baseFacility,
          complianceDocumentName: null,
          complianceDocumentUrl: null,
          complianceDocumentDisplayUrl: null,
        }}
      />,
    );

    expect(screen.queryByText('HIPAA-Certificate.pdf')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view/i })).not.toBeInTheDocument();
  });
});

describe('FacilityForm — empty state', () => {
  it('shows "No Facility Found" when initialData is null', () => {
    render(<FacilityForm initialData={null} />);

    expect(screen.getByText('No Facility Found')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
