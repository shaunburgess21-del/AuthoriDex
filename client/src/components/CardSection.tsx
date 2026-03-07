import { useMemo, type ReactNode } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Pagination, A11y } from "swiper/modules";
import "swiper/css";
import "swiper/css/pagination";

interface CardSectionProps {
  children: ReactNode[];
  desktopLimit?: number;
  columns?: 2 | 3;
  gap?: string;
  testIdPrefix?: string;
  dotActiveColor?: string;
}

export function CardSection({
  children,
  desktopLimit = 9,
  columns = 3,
  gap = "gap-5",
  testIdPrefix = "card-section",
  dotActiveColor = "bg-cyan-400",
}: CardSectionProps) {
  const items = useMemo(() => children.filter(Boolean), [children]);
  const desktopItems = items.slice(0, desktopLimit);
  const dotActive = dotActiveColor.includes("violet") ? "violet" : "cyan";

  if (items.length === 0) return null;

  const gridCols = columns === 2
    ? "md:grid-cols-2"
    : "md:grid-cols-2 lg:grid-cols-3";

  return (
    <div data-testid={testIdPrefix}>
      <div className={`hidden md:grid grid-cols-1 ${gridCols} ${gap}`}>
        {desktopItems}
      </div>

      <div className="md:hidden authoridex-swiper" data-dot-active={dotActive}>
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
          }}
          a11y={{
            enabled: true,
            prevSlideMessage: "Previous slide",
            nextSlideMessage: "Next slide",
          }}
          className="py-2"
          data-testid={`${testIdPrefix}-carousel`}
        >
          {items.map((item, i) => (
            <SwiperSlide key={i}>
              <div className="w-full px-1">
                {item}
              </div>
            </SwiperSlide>
          ))}
        </Swiper>
      </div>
    </div>
  );
}
