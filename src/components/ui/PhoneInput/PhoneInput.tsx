'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

const countries = [
  { code: 'US', name: 'United States', dialCode: '+1', flag: '🇺🇸', expectedLength: 10 },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44', flag: '🇬🇧', expectedLength: 10 },
  { code: 'CA', name: 'Canada', dialCode: '+1', flag: '🇨🇦', expectedLength: 10 },
  { code: 'AU', name: 'Australia', dialCode: '+61', flag: '🇦🇺' },
  { code: 'DE', name: 'Germany', dialCode: '+49', flag: '🇩🇪' },
  { code: 'FR', name: 'France', dialCode: '+33', flag: '🇫🇷' },
  { code: 'IT', name: 'Italy', dialCode: '+39', flag: '🇮🇹' },
  { code: 'ES', name: 'Spain', dialCode: '+34', flag: '🇪🇸' },
  { code: 'NL', name: 'Netherlands', dialCode: '+31', flag: '🇳🇱' },
  { code: 'BE', name: 'Belgium', dialCode: '+32', flag: '🇧🇪' },
  { code: 'CH', name: 'Switzerland', dialCode: '+41', flag: '🇨🇭' },
  { code: 'AT', name: 'Austria', dialCode: '+43', flag: '🇦🇹' },
  { code: 'SE', name: 'Sweden', dialCode: '+46', flag: '🇸🇪' },
  { code: 'NO', name: 'Norway', dialCode: '+47', flag: '🇳🇴' },
  { code: 'DK', name: 'Denmark', dialCode: '+45', flag: '🇩🇰' },
  { code: 'FI', name: 'Finland', dialCode: '+358', flag: '🇫🇮' },
  { code: 'IE', name: 'Ireland', dialCode: '+353', flag: '🇮🇪' },
  { code: 'PT', name: 'Portugal', dialCode: '+351', flag: '🇵🇹' },
  { code: 'GR', name: 'Greece', dialCode: '+30', flag: '🇬🇷' },
  { code: 'PL', name: 'Poland', dialCode: '+48', flag: '🇵🇱' },
  { code: 'CZ', name: 'Czech Republic', dialCode: '+420', flag: '🇨🇿' },
  { code: 'HU', name: 'Hungary', dialCode: '+36', flag: '🇭🇺' },
  { code: 'RO', name: 'Romania', dialCode: '+40', flag: '🇷🇴' },
  { code: 'BG', name: 'Bulgaria', dialCode: '+359', flag: '🇧🇬' },
  { code: 'HR', name: 'Croatia', dialCode: '+385', flag: '🇭🇷' },
  { code: 'SK', name: 'Slovakia', dialCode: '+421', flag: '🇸🇰' },
  { code: 'SI', name: 'Slovenia', dialCode: '+386', flag: '🇸🇮' },
  { code: 'RS', name: 'Serbia', dialCode: '+381', flag: '🇷🇸' },
  { code: 'UA', name: 'Ukraine', dialCode: '+380', flag: '🇺🇦' },
  { code: 'RU', name: 'Russia', dialCode: '+7', flag: '🇷🇺' },
  { code: 'TR', name: 'Turkey', dialCode: '+90', flag: '🇹🇷' },
  { code: 'IL', name: 'Israel', dialCode: '+972', flag: '🇮🇱' },
  { code: 'AE', name: 'United Arab Emirates', dialCode: '+971', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia', dialCode: '+966', flag: '🇸🇦' },
  { code: 'QA', name: 'Qatar', dialCode: '+974', flag: '🇶🇦' },
  { code: 'KW', name: 'Kuwait', dialCode: '+965', flag: '🇰🇼' },
  { code: 'EG', name: 'Egypt', dialCode: '+20', flag: '🇪🇬' },
  { code: 'ZA', name: 'South Africa', dialCode: '+27', flag: '🇿🇦' },
  { code: 'NG', name: 'Nigeria', dialCode: '+234', flag: '🇳🇬' },
  { code: 'KE', name: 'Kenya', dialCode: '+254', flag: '🇰🇪' },
  { code: 'GH', name: 'Ghana', dialCode: '+233', flag: '🇬🇭' },
  { code: 'MA', name: 'Morocco', dialCode: '+212', flag: '🇲🇦' },
  { code: 'TN', name: 'Tunisia', dialCode: '+216', flag: '🇹🇳' },
  { code: 'IN', name: 'India', dialCode: '+91', flag: '🇮🇳' },
  { code: 'PK', name: 'Pakistan', dialCode: '+92', flag: '🇵🇰' },
  { code: 'BD', name: 'Bangladesh', dialCode: '+880', flag: '🇧🇩' },
  { code: 'LK', name: 'Sri Lanka', dialCode: '+94', flag: '🇱🇰' },
  { code: 'NP', name: 'Nepal', dialCode: '+977', flag: '🇳🇵' },
  { code: 'CN', name: 'China', dialCode: '+86', flag: '🇨🇳' },
  { code: 'JP', name: 'Japan', dialCode: '+81', flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea', dialCode: '+82', flag: '🇰🇷' },
  { code: 'TW', name: 'Taiwan', dialCode: '+886', flag: '🇹🇼' },
  { code: 'HK', name: 'Hong Kong', dialCode: '+852', flag: '🇭🇰' },
  { code: 'SG', name: 'Singapore', dialCode: '+65', flag: '🇸🇬' },
  { code: 'MY', name: 'Malaysia', dialCode: '+60', flag: '🇲🇾' },
  { code: 'ID', name: 'Indonesia', dialCode: '+62', flag: '🇮🇩' },
  { code: 'TH', name: 'Thailand', dialCode: '+66', flag: '🇹🇭' },
  { code: 'VN', name: 'Vietnam', dialCode: '+84', flag: '🇻🇳' },
  { code: 'PH', name: 'Philippines', dialCode: '+63', flag: '🇵🇭' },
  { code: 'NZ', name: 'New Zealand', dialCode: '+64', flag: '🇳🇿' },
  { code: 'MX', name: 'Mexico', dialCode: '+52', flag: '🇲🇽' },
  { code: 'BR', name: 'Brazil', dialCode: '+55', flag: '🇧🇷' },
  { code: 'AR', name: 'Argentina', dialCode: '+54', flag: '🇦🇷' },
  { code: 'CL', name: 'Chile', dialCode: '+56', flag: '🇨🇱' },
  { code: 'CO', name: 'Colombia', dialCode: '+57', flag: '🇨🇴' },
  { code: 'PE', name: 'Peru', dialCode: '+51', flag: '🇵🇪' },
  { code: 'VE', name: 'Venezuela', dialCode: '+58', flag: '🇻🇪' },
  { code: 'EC', name: 'Ecuador', dialCode: '+593', flag: '🇪🇨' },
  { code: 'UY', name: 'Uruguay', dialCode: '+598', flag: '🇺🇾' },
  { code: 'PY', name: 'Paraguay', dialCode: '+595', flag: '🇵🇾' },
  { code: 'BO', name: 'Bolivia', dialCode: '+591', flag: '🇧🇴' },
  { code: 'PA', name: 'Panama', dialCode: '+507', flag: '🇵🇦' },
  { code: 'CR', name: 'Costa Rica', dialCode: '+506', flag: '🇨🇷' },
  { code: 'DO', name: 'Dominican Republic', dialCode: '+1', flag: '🇩🇴' },
  { code: 'PR', name: 'Puerto Rico', dialCode: '+1', flag: '🇵🇷' },
  { code: 'JM', name: 'Jamaica', dialCode: '+1', flag: '🇯🇲' },
  { code: 'TT', name: 'Trinidad and Tobago', dialCode: '+1', flag: '🇹🇹' },
  { code: 'BS', name: 'Bahamas', dialCode: '+1', flag: '🇧🇸' },
  { code: 'CU', name: 'Cuba', dialCode: '+53', flag: '🇨🇺' },
  { code: 'HT', name: 'Haiti', dialCode: '+509', flag: '🇭🇹' },
];

interface PhoneInputProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  error?: string;
  defaultCountry?: string;
  /** Restrict the country selector to only these country codes (e.g. ['US']). */
  allowedCountries?: string[];
  disabled?: boolean;
}

export default function PhoneInput({
  value = '',
  onChange,
  placeholder = 'Enter the phone number of the main contact',
  error,
  defaultCountry = 'US',
  allowedCountries,
  disabled = false,
}: PhoneInputProps) {
  const visibleCountries = allowedCountries
    ? countries.filter((c) => allowedCountries.includes(c.code))
    : countries;

  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedCountry, setSelectedCountry] = useState(
    visibleCountries.find((c) => c.code === defaultCountry) || visibleCountries[0],
  );
  const [phoneNumber, setPhoneNumber] = useState(value);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setPhoneNumber(value);
  }

  // When only one country is allowed, keep the dropdown closed
  const isSingleCountry = visibleCountries.length <= 1;

  const filteredCountries = visibleCountries.filter(
    (country) =>
      country.name.toLowerCase().includes(search.toLowerCase()) ||
      country.dialCode.includes(search) ||
      country.code.toLowerCase().includes(search.toLowerCase()),
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const handleCountrySelect = (country: (typeof countries)[0]) => {
    setSelectedCountry(country);
    setIsOpen(false);
    setSearch('');
    if (onChange) {
      onChange(`${country.dialCode} ${phoneNumber}`);
    }
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;

    if (selectedCountry.code === 'US') {
      let digits = rawValue.replace(/\D/g, '');

      // Since US numbers are formatted with +1, the first digit is usually '1' from the prefix.
      // If the digits start with '1', strip it so we only deal with the 10-digit local number.
      if (digits.startsWith('1')) {
        digits = digits.substring(1);
      }

      digits = digits.substring(0, 10);

      // Handle backspace over formatting characters
      const oldPhone = phoneNumber || '';
      if (rawValue.length < oldPhone.length) {
        if (oldPhone.endsWith('-') && rawValue === oldPhone.slice(0, -1)) {
          digits = digits.slice(0, -1);
        } else if (oldPhone.endsWith(')') && rawValue === oldPhone.slice(0, -1)) {
          digits = digits.slice(0, -1);
        }
      }

      let newPhone = '';
      if (digits.length === 0) {
        newPhone = rawValue.includes('+') ? '+1' : ''; // Allow clearing completely
      } else if (digits.length < 3) {
        newPhone = `+1 (${digits}`;
      } else if (digits.length === 3) {
        if (oldPhone === `+1 (${digits})-` && rawValue === `+1 (${digits}`) {
          newPhone = `+1 (${digits.slice(0, 2)}`;
        } else {
          newPhone = `+1 (${digits})-`;
        }
      } else if (digits.length < 6) {
        newPhone = `+1 (${digits.substring(0, 3)})-${digits.substring(3)}`;
      } else if (digits.length === 6) {
        if (
          oldPhone === `+1 (${digits.substring(0, 3)})-${digits.substring(3)}-` &&
          rawValue === `+1 (${digits.substring(0, 3)})-${digits.substring(3)}`
        ) {
          newPhone = `+1 (${digits.substring(0, 3)})-${digits.substring(3, 5)}`;
        } else {
          newPhone = `+1 (${digits.substring(0, 3)})-${digits.substring(3)}-`;
        }
      } else {
        newPhone = `+1 (${digits.substring(0, 3)})-${digits.substring(3, 6)}-${digits.substring(6, 10)}`;
      }

      setPhoneNumber(newPhone);
      if (onChange) {
        onChange(newPhone);
      }
    } else {
      const digits = rawValue.replace(/\D/g, '');
      const maxLength = selectedCountry.expectedLength || 15;
      const newPhone = digits.slice(0, maxLength);
      setPhoneNumber(newPhone);
      if (onChange) {
        onChange(`${selectedCountry.dialCode} ${newPhone}`);
      }
    }
  };

  return (
    <div className="relative w-full" ref={dropdownRef}>
      <div
        className={cn(
          'flex h-14 w-full items-center rounded-[10px] border bg-background transition-colors',
          'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
          error ? 'border-destructive focus-within:ring-destructive/20' : 'border-input',
          disabled && 'pointer-events-none bg-secondary opacity-60',
        )}
      >
        <button
          type="button"
          className="flex h-full items-center gap-1.5 rounded-l-[10px] px-3 text-text-secondary transition-colors hover:bg-background-secondary disabled:cursor-default disabled:hover:bg-transparent"
          onClick={() => !isSingleCountry && setIsOpen(!isOpen)}
          disabled={isSingleCountry || disabled}
        >
          <span className="text-xl leading-none">{selectedCountry.flag}</span>
          <ChevronDown
            className={cn('size-3 text-text-tertiary transition-transform', isOpen && 'rotate-180')}
            aria-hidden="true"
          />
        </button>

        <div className="h-6 w-px bg-border" />

        <input
          type="tel"
          className="h-full flex-1 border-none bg-transparent px-4 text-base text-foreground outline-none placeholder:text-muted-foreground"
          value={phoneNumber}
          disabled={disabled}
          onChange={handlePhoneChange}
          onFocus={() => {
            if (selectedCountry.code === 'US' && (!phoneNumber || phoneNumber === '+1')) {
              const newPhone = '+1 (';
              setPhoneNumber(newPhone);
              if (onChange) onChange(newPhone);
            }
          }}
          placeholder={placeholder}
        />
      </div>

      {isOpen && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-[1000] max-h-[360px] w-80 max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border border-border bg-background shadow-lg">
          <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
            <Search className="size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="text"
              className="flex-1 border-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              placeholder="Search countries..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="max-h-[280px] overflow-y-auto py-2">
            {filteredCountries.map((country) => (
              <button
                key={country.code}
                type="button"
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-background-secondary',
                  selectedCountry.code === country.code && 'bg-primary/10',
                )}
                onClick={() => handleCountrySelect(country)}
              >
                <span className="text-xl leading-none">{country.flag}</span>
                <span className="flex-1 text-sm font-medium text-foreground">{country.name}</span>
                <span className="text-[13px] font-medium text-text-secondary">
                  {country.dialCode}
                </span>
              </button>
            ))}
            {filteredCountries.length === 0 && (
              <div className="p-4 text-center text-sm text-text-tertiary">No countries found</div>
            )}
          </div>
        </div>
      )}

      {error && <span className="mt-1.5 block text-[13px] text-error">{error}</span>}
    </div>
  );
}
