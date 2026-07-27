const bar = 'animate-pulse rounded-full bg-[#f0f0f0]';
const block = 'animate-pulse rounded-[11px] bg-[#f0f0f0]';

export default function Loading() {
  return (
    <div className="flex flex-col pb-16">
      <div className="px-6 pt-7 lg:px-[107px] lg:pt-[51px]">
        <div className={`h-[22px] w-[166px] ${bar}`} />
      </div>

      <div className="mx-auto mt-7 flex w-full max-w-[960px] flex-col gap-8 px-6 lg:mt-[42px] lg:px-0">
        <div className="flex items-center gap-[46px]">
          <div className={`h-[31px] w-[156px] ${bar}`} />
          <div className={`h-[31px] w-[201px] ${bar}`} />
        </div>

        <div className="flex flex-col gap-[27px]">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex flex-col gap-[16px]">
              <div className={`h-[15px] w-[89px] ${bar}`} />
              {row === 0 ? (
                <div className="grid grid-cols-1 gap-[17px] sm:grid-cols-2">
                  <div className={`h-[49px] w-full ${block}`} />
                  <div className={`h-[49px] w-full ${block}`} />
                </div>
              ) : (
                <div className={`h-[49px] w-full ${block}`} />
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-[17px]">
          <div className={`h-[49px] w-[133px] ${block}`} />
          <div className={`h-[49px] w-[193px] ${block}`} />
        </div>
      </div>
    </div>
  );
}
