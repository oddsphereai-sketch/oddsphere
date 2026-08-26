export type SportTabActivationEvent = {
  preventDefault: () => void;
  stopPropagation: () => void;
};

/**
 * Pointer activation happens before a modal can be refreshed or unmounted.
 * The following synthetic click is consumed so one gesture can produce only
 * one navigation. Keyboard clicks have no preceding pointer and still activate.
 */
export function createSportTabActivationGuard<TSport>() {
  let pointerActivatedSport: TSport | null = null;

  return {
    pointerDown(
      event: SportTabActivationEvent,
      sport: TSport,
      activate: (sport: TSport) => void,
    ) {
      event.preventDefault();
      event.stopPropagation();
      pointerActivatedSport = sport;
      activate(sport);
    },
    click(
      event: Pick<SportTabActivationEvent, "stopPropagation">,
      sport: TSport,
      activate: (sport: TSport) => void,
    ) {
      event.stopPropagation();
      if (pointerActivatedSport === sport) {
        pointerActivatedSport = null;
        return;
      }
      activate(sport);
    },
  };
}
