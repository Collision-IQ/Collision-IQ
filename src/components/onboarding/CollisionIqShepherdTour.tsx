"use client";

import { useEffect, useRef } from "react";
import Shepherd from "shepherd.js";
import type { PopperPlacement, StepOptions, StepOptionsButton, Tour } from "shepherd.js";
import "./shepherd-theme.css";

const TOUR_STORAGE_KEY = "collisionIq.firstReviewWalkthrough.completed";
const TOUR_RESTART_EVENT = "collisioniq:tutorial:start";
const TOUR_START_DELAY_MS = 900;
const IS_DEV = process.env.NODE_ENV !== "production";

type TourInstance = Tour;

type TourTarget = {
  id: string;
  title: string;
  text: string;
  selectors?: string[];
  desktopPlacement?: PopperPlacement;
  mobilePlacement?: PopperPlacement;
};

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function isVisibleElement(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    style.opacity !== "0"
  );
}

function findVisibleTarget(selectors: string[] = []) {
  for (const selector of selectors) {
    const element = Array.from(document.querySelectorAll(selector)).find(isVisibleElement);
    if (element) {
      return element;
    }
  }

  return null;
}

function getPlacement(target: TourTarget) {
  const isMobile = window.matchMedia("(max-width: 767px)").matches;
  return isMobile
    ? target.mobilePlacement ?? target.desktopPlacement ?? "bottom"
    : target.desktopPlacement ?? "bottom";
}

function buildButtons(isLast: boolean): StepOptions["buttons"] {
  const buttons: StepOptionsButton[] = [
    {
      text: "Back",
      classes: "shepherd-button-secondary",
      action() {
        this.back();
      },
    },
  ];

  buttons.push({
    text: isLast ? "Done" : "Next",
    classes: "shepherd-button-primary",
    action() {
      if (isLast) {
        this.complete();
        return;
      }
      this.next();
    },
  });

  return buttons;
}

function buildTour() {
  if (IS_DEV) {
    console.info("[onboarding-tour] Shepherd module shape", {
      type: typeof Shepherd,
      keys: Object.keys(Shepherd),
      hasTour: typeof Shepherd.Tour === "function",
      hasStep: typeof Shepherd.Step === "function",
    });

    if (!document.querySelector('[data-tour="nav-my-vehicle"]')) {
      console.warn('[onboarding-tour] Missing expected target: [data-tour="nav-my-vehicle"]');
    }
  }

  const targets: TourTarget[] = [
    {
      id: "welcome",
      title: "Welcome to Collision IQ",
      text: "This workspace helps you review estimates, OEM procedures, photos, and claim documents in one structured repair analysis.",
      selectors: ['[data-tour="app-header"]'],
      desktopPlacement: "bottom-start",
      mobilePlacement: "bottom",
    },
    {
      id: "command-center",
      title: "Command Center",
      text: "Use the Command Center to move between the main analysis workspace, evidence, vehicle details, reports, knowledge base, calibration tools, and settings.",
      selectors: ['[data-tour="command-center-sidebar"]'],
      desktopPlacement: "right-start",
      mobilePlacement: "bottom",
    },
    {
      id: "evidence",
      title: "Evidence",
      text: "Evidence is where uploaded files, photos, procedures, and support documents can be organized for review.",
      selectors: ['[data-tour="nav-evidence"]'],
      desktopPlacement: "right",
      mobilePlacement: "bottom",
    },
    {
      id: "my-vehicle",
      title: "My Vehicle",
      text: "Add your vehicle details here so Collision IQ can tailor repair, maintenance, and safety guidance to the correct vehicle. Start with the VIN when available so the system can decode the year, make, model, and configuration. You can also confirm mileage and add recent maintenance dates. Over time, Collision IQ can use this information to help remind you when maintenance or safety-related service may be due.",
      selectors: ['[data-tour="nav-my-vehicle"]'],
      desktopPlacement: "right",
      mobilePlacement: "bottom",
    },
    {
      id: "reports",
      title: "Reports",
      text: "Reports is where generated outputs should be available, including estimate reviews, delta reports, citation reports, and downloadable summaries.",
      selectors: ['[data-tour="nav-reports"]'],
      desktopPlacement: "right",
      mobilePlacement: "bottom",
    },
    {
      id: "knowledge-base",
      title: "Knowledge Base",
      text: "The Knowledge Base connects Collision IQ to repair procedures, position statements, calibration guidance, and other support material used during analysis.",
      selectors: ['[data-tour="nav-knowledge-base"]'],
      desktopPlacement: "right",
      mobilePlacement: "bottom",
    },
    {
      id: "calibration",
      title: "Calibration",
      text: "Calibration helps users focus on ADAS, scan, calibration, and safety-related repair requirements.",
      selectors: ['[data-tour="nav-calibration"]'],
      desktopPlacement: "right",
      mobilePlacement: "bottom",
    },
    {
      id: "upload",
      title: "Upload Your Files",
      text: "Start by uploading an estimate, supplement, OEM procedure, photo, or supporting document. Collision IQ will use these files as the basis for the review.",
      selectors: ['[data-tour="upload-button"]'],
      desktopPlacement: "top",
      mobilePlacement: "top",
    },
    {
      id: "camera",
      title: "Add Damage Photos",
      text: "Use the camera button to add repair photos when visual context will help the analysis.",
      selectors: ['[data-tour="camera-button"]'],
      desktopPlacement: "top",
      mobilePlacement: "top",
    },
    {
      id: "photo-generator",
      title: "Photo Generator & Visual Support",
      text: "Use this tool when photos can help the review. Collision IQ can use visual context to support damage review, repair discussion, and customer-facing explanations.",
      selectors: ['[data-tour="photo-generator-button"]'],
      desktopPlacement: "top",
      mobilePlacement: "top",
    },
    {
      id: "command",
      title: "Enter Your Review Command",
      text: "Tell Collision IQ what you want reviewed. For example: “Compare these two estimates and identify every changed item.”",
      selectors: ['[data-tour="chat-input"]'],
      desktopPlacement: "top",
      mobilePlacement: "top",
    },
    {
      id: "send",
      title: "Send for Analysis",
      text: "Send starts the review. The bot will analyze the uploaded materials and produce a structured response.",
      selectors: ['[data-tour="send-button"]'],
      desktopPlacement: "top",
      mobilePlacement: "top",
    },
    {
      id: "damage-preview",
      title: "Damage Preview",
      text: "Uploaded photos appear here so you can confirm the visual evidence attached to the review.",
      selectors: ['[data-tour="damage-preview"]'],
      desktopPlacement: "top",
      mobilePlacement: "top",
    },
    {
      id: "download",
      title: "Download Reports",
      text: "When reports are generated, use Download to save or share the output.",
      selectors: ['[data-tour="download-button"]'],
      desktopPlacement: "top",
      mobilePlacement: "top",
    },
    {
      id: "services",
      title: "More Collision Academy Services",
      text: "Use these links to access related services, including diminished value, total loss disputes, Right to Appraisal support, shop applications, professional services, and other Collision Academy resources.",
      selectors: ['[data-tour="service-links"]'],
      desktopPlacement: "top",
      mobilePlacement: "top",
    },
    {
      id: "end",
      title: "End the Session",
      text: "Use End when the current review is complete and you are ready to start fresh.",
      selectors: ['[data-tour="end-button"]'],
      desktopPlacement: "top",
      mobilePlacement: "top",
    },
  ];

  const tour = new Shepherd.Tour({
    tourName: "First Review Walkthrough",
    useModalOverlay: true,
    exitOnEsc: true,
    keyboardNavigation: true,
    defaultStepOptions: {
      cancelIcon: {
        enabled: true,
      },
      canClickTarget: false,
      classes: "collision-iq-shepherd",
      highlightClass: "collision-iq-shepherd-target",
      modalOverlayOpeningPadding: 10,
      modalOverlayOpeningRadius: 14,
      scrollTo: {
        behavior: "smooth",
        block: "center",
      },
    },
  });

  targets.forEach((target, index) => {
    tour.addStep({
      id: target.id,
      title: target.title,
      text: target.text,
      attachTo: {
        element: () => findVisibleTarget(target.selectors),
        on: getPlacement(target),
      },
      beforeShowPromise: () =>
        new Promise((resolve) => {
          window.setTimeout(resolve, 80);
        }),
      showOn: () => !target.selectors || Boolean(findVisibleTarget(target.selectors)),
      buttons: buildButtons(index === targets.length - 1),
    });
  });

  tour.on("complete", () => {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "true");
  });
  tour.on("cancel", () => {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "true");
  });

  return tour;
}

export default function CollisionIqShepherdTour() {
  const mountedRef = useRef(false);
  const tourRef = useRef<TourInstance | null>(null);

  useEffect(() => {
    if (!isBrowser() || mountedRef.current) {
      return;
    }

    mountedRef.current = true;
    let disposed = false;
    let timer: number | null = null;

    async function startTour(force = false) {
      try {
        if (disposed) {
          return;
        }

        if (tourRef.current?.isActive()) {
          await tourRef.current.cancel();
        }

        if (disposed) {
          return;
        }

        const hasCompleted = window.localStorage.getItem(TOUR_STORAGE_KEY) === "true";
        if (hasCompleted && !force) {
          return;
        }

        const tour = buildTour();
        tourRef.current = tour;
        await tour.start();
      } catch (error) {
        console.warn("[onboarding-tour] Shepherd tour could not start", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    function handleRestart() {
      window.localStorage.removeItem(TOUR_STORAGE_KEY);
      void startTour(true);
    }

    window.addEventListener(TOUR_RESTART_EVENT, handleRestart);
    timer = window.setTimeout(() => {
      void startTour(false);
    }, TOUR_START_DELAY_MS);

    return () => {
      disposed = true;
      window.removeEventListener(TOUR_RESTART_EVENT, handleRestart);
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      if (tourRef.current?.isActive()) {
        void tourRef.current.cancel();
      }
      tourRef.current = null;
    };
  }, []);

  return null;
}
