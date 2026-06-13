import React from 'react';
import Image from 'next/image';
import InspectorsActions from './InspectorsActions';

interface InspectorsSectionProps {
  showActions?: boolean;
}

const cardClass =
  'flex h-full flex-col rounded-[20px] border border-border-light bg-[#fafafa] p-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-sm sm:p-6';
const cardTitleClass = 'mb-4 text-xl font-semibold leading-tight text-[#0b1a38] sm:text-2xl';
const cardDescClass = 'mb-6 text-sm leading-relaxed text-[#6b7280] sm:mb-10 sm:text-[15px]';
const cardImageWrapperClass =
  'relative mt-auto flex flex-1 items-end justify-center overflow-hidden';
const cardImageClass = 'block h-auto w-full object-contain';

export default function InspectorsSection({ showActions = true }: InspectorsSectionProps) {
  return (
    <section className="flex flex-col items-center bg-background px-4 py-12 sm:px-6 sm:py-14 lg:py-20">
      <div className="mb-10 text-center sm:mb-16">
        <h2 className="mb-4 text-2xl font-bold leading-tight tracking-[-0.02em] text-[#0b1a38] sm:text-[28px] lg:text-[40px]">
          What Inspectors actually ask for
        </h2>
        <p className="text-[15px] text-text-secondary sm:text-base">
          During inspections, surveyors typically request:
        </p>
      </div>

      <div className="grid w-full max-w-[1200px] grid-cols-1 gap-6 md:grid-cols-6">
        {/* Card 1 */}
        <div className={`${cardClass} md:col-span-3 lg:col-span-2`}>
          <h3 className={cardTitleClass}>Staffs Completion Records</h3>
          <p className={cardDescClass}>
            Theraptly tracks every staff member&apos;s training activity, giving you clear,
            individual completion records inspectors can easily review.
          </p>
          <div className={cardImageWrapperClass}>
            <Image
              src="/images/inspector-01.jpg"
              alt="Staff completion records UI mockup"
              width={400}
              height={250}
              className={cardImageClass}
            />
          </div>
        </div>

        {/* Card 2 */}
        <div className={`${cardClass} md:col-span-3 lg:col-span-2`}>
          <h3 className={cardTitleClass}>Completion Timestamps</h3>
          <p className={cardDescClass}>
            Theraptly automatically logs precise timestamps for every training completed, ensuring
            your records are accurate and inspection-ready.
          </p>
          <div className={cardImageWrapperClass}>
            <Image
              src="/images/inspector-02.jpg"
              alt="Completion timestamps UI mockup"
              width={400}
              height={250}
              className={cardImageClass}
            />
          </div>
        </div>

        {/* Card 3 */}
        <div className={`${cardClass} md:col-span-6 lg:col-span-2`}>
          <h3 className={cardTitleClass}>Course Results</h3>
          <p className={cardDescClass}>
            Theraptly captures knowledge check outcomes for each course, showing that staff not only
            completed training but understood the material.
          </p>
          <div className={cardImageWrapperClass}>
            <Image
              src="/images/inspector-03.jpg"
              alt="Course results line graph mockup"
              width={400}
              height={250}
              className={cardImageClass}
            />
          </div>
        </div>

        {/* Card 4 */}
        <div className={`${cardClass} md:col-span-6 lg:col-span-3`}>
          <h3 className={cardTitleClass}>Source Policy the Training Was Based On</h3>
          <p className={cardDescClass}>
            Theraptly links every training module back to its original policy, so inspectors can
            clearly see exactly what each course is based on, without any confusion or gaps.
          </p>
          <div className={cardImageWrapperClass}>
            <Image
              src="/images/inspector-04.jpg"
              alt="Policy links diagram mockup"
              width={600}
              height={300}
              className={cardImageClass}
            />
          </div>
        </div>

        {/* Card 5 */}
        <div className={`${cardClass} md:col-span-6 lg:col-span-3`}>
          <h3 className={cardTitleClass}>Exportable Documentation They Can Review On-Site</h3>
          <p className={cardDescClass}>
            Theraptly compiles all training data into clean, exportable reports, making it easy to
            present documentation during inspections.
          </p>
          <div className={cardImageWrapperClass}>
            <Image
              src="/images/inspector-05.jpg"
              alt="Exportable documentation modal mockup"
              width={600}
              height={300}
              className={cardImageClass}
            />
          </div>
        </div>
      </div>

      {showActions && <InspectorsActions />}
    </section>
  );
}
