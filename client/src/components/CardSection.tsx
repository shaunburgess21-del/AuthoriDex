import { useMemo, type ReactNode } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Pagination, A11y } from "swiper/modules";
import "swiper/css";
import "swiper/css/pagination";

interface CardSectionProps {
  children: ReactNode[];
  desktopLimit?: number;
  mobileLimit?: number;
  columns?: 2 | 3;
  gap?: string;
  testIdPrefix?: string;
  dotActiveColor?: string;
}

const DEFAULT_MOBILE_LIMIT = 8;

export function CardSection({
  children,
  desktopLimit = 9,
  mobileLimit = DEFAULT_MOBILE_LIMIT,
  columns = 3,
  gap = "gap-5",
  testIdPrefix = "card-section",
  dotActiveColor = "bg-cyan-400",
}: CardSectionProps) {
  const items = useMemo(() => children.filter(Boolean), [children]);
  const desktopItems = items.slice(0, desktopLimit);
  const mobileItems = useMemo(
    () => items.slice(0, mobileLimit),
    [items, mobileLimit]
  );
  const dotActive = dotActiveColor.includes("violet") ? "violet" : "cyan";

  if (items.length === 0) return null;

  const gridCols = columns === 2
    ? "md:grid-cols-2"
    : "md:grid-cols-2 lg:grid-cols-3";

  const hasMobileSlides = mobileItems.length > 0;

  return (
    <div data-testid={testIdPrefix}>
      <div className={`hidden md:grid grid-cols-1 ${gridCols} ${gap}`}>
        {desktopItems}
      </div>

      <div className="md:hidden authoridex-swiper" data-dot-active={dotActive}>
        {hasMobileSlides && (
        <Swiper
          modules={[Pagination, A11y]}
          spaceBetween={12}
          slidesPerView={1}
          threshold={10}
          touchAngle={45}
          resistanceRatio={0.85}
          speed={300}
          cssMode={false}
          pagination={{
            clickable: true,
            dynamicBullets: true,
            dynamicMainBullets: 3,
          }}
          a11y={{
            enabled: true,
            prevSlideMessage: "Previous slide",
            nextSlideMessage: "Next slide",
          }}
          className="py-2"
          data-testid={`${testIdPrefix}-carousel`}
        >
          {mobileItems.map((item, i) => (
            <SwiperSlide key={i}>
              <div className="w-full px-1">
                {item}
              </div>
            </SwiperSlide>
          ))}
        </Swiper>
        )}
      </div>
    </div>
  );
}
