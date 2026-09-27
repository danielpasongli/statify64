import { useEffect, useRef, useState } from "react";

// Charts this far below/above the visible area are mounted in advance.
const ROOT_MARGIN = "800px 0px";

function findScrollParent(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;
  while (current) {
    const { overflowY } = window.getComputedStyle(current);
    if (overflowY === "auto" || overflowY === "scroll") return current;
    current = current.parentElement;
  }
  return null;
}

/**
 * True once the element has come near the visible part of its scroll
 * container, and stays true afterwards. Lets heavy KNN charts skip their
 * first render while the output viewer mounts every result at once.
 * Without IntersectionObserver (tests, old browsers) it is true immediately.
 */
export function useMountWhenNearViewport<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [isNear, setIsNear] = useState(
    () => typeof window === "undefined" || typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (isNear) return;
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNear(true);
          observer.disconnect();
        }
      },
      { root: findScrollParent(element), rootMargin: ROOT_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [isNear]);

  return [ref, isNear] as const;
}
