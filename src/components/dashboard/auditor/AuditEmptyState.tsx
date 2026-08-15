import Image from 'next/image';

interface AuditEmptyStateProps {
  message: string;
  subMessage: string;
}

/** The design's purple search-doc illustration (node 15502:137339) over real text. */
export default function AuditEmptyState({ message, subMessage }: AuditEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 px-6 py-16">
      <Image
        src="/images/audit-empty-state.svg"
        alt=""
        width={187}
        height={150}
        aria-hidden="true"
        className="h-[120px] w-auto md:h-[150px]"
      />
      <div className="flex max-w-[320px] flex-col gap-1.5 text-center">
        <p className="text-[16px] font-semibold leading-[1.3] text-[#11181c] md:text-[17px]">
          {message}
        </p>
        <p className="text-[14px] leading-[1.5] text-[#8f92a1]">{subMessage}</p>
      </div>
    </div>
  );
}
