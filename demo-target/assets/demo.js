// Deliberately fake fixture for the team's authorized demonstration site.
// It is safe to publish and must never be replaced with a real credential.
const api_token = "DEMO_ONLY_NOT_A_REAL_TOKEN_123456";
window.demoEnvironment = { name: "synthetic-competition-fixture", api_token };

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, reducedMotion ? 20 : milliseconds));

// Scroll reveal and staggered entrance effects.
const revealItems = document.querySelectorAll(".reveal");
revealItems.forEach((item) => {
  if (item.dataset.delay) item.style.setProperty("--delay", `${item.dataset.delay}ms`);
});

if ("IntersectionObserver" in window && !reducedMotion) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px" });
  revealItems.forEach((item) => revealObserver.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

// Animated project figures.
const counters = document.querySelectorAll(".counter");
const animateCounter = (counter) => {
  const target = Number(counter.dataset.count || 0);
  const startedAt = performance.now();
  const duration = 950;
  const tick = (now) => {
    const progress = Math.min((now - startedAt) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    counter.textContent = String(Math.round(target * eased)).padStart(2, "0");
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

if ("IntersectionObserver" in window && !reducedMotion) {
  const counterObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      animateCounter(entry.target);
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.6 });
  counters.forEach((counter) => counterObserver.observe(counter));
} else {
  counters.forEach((counter) => { counter.textContent = String(counter.dataset.count).padStart(2, "0"); });
}

// Pointer glow is intentionally subtle and only enabled for precise pointers.
const pointerGlow = document.querySelector(".pointer-glow");
if (pointerGlow && window.matchMedia("(pointer: fine)").matches && !reducedMotion) {
  document.addEventListener("pointermove", (event) => {
    pointerGlow.style.opacity = "1";
    pointerGlow.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
  });
}

// A light parallax response gives the hero console depth without blocking touch users.
const heroScanCard = document.querySelector("#heroScanCard");
if (heroScanCard && window.matchMedia("(pointer: fine)").matches && !reducedMotion) {
  heroScanCard.addEventListener("pointermove", (event) => {
    const rect = heroScanCard.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    heroScanCard.style.setProperty("--ry", `${x * 8}deg`);
    heroScanCard.style.setProperty("--rx", `${y * -7}deg`);
  });
  heroScanCard.addEventListener("pointerleave", () => {
    heroScanCard.style.setProperty("--ry", "-5deg");
    heroScanCard.style.setProperty("--rx", "2deg");
  });
}

// Replay the compact hero scan without making a real request.
const replayButton = document.querySelector(".scan-replay");
const heroSteps = [...document.querySelectorAll("[data-hero-step]")];
const setHeroStep = (step, state, label) => {
  const badge = step?.querySelector("i");
  if (!badge) return;
  badge.className = state;
  badge.textContent = label;
};
replayButton?.addEventListener("click", async () => {
  replayButton.disabled = true;
  heroSteps.forEach((step) => setHeroStep(step, "queued", "排队"));
  for (const step of heroSteps) {
    setHeroStep(step, "running", "分析中");
    await delay(520);
    setHeroStep(step, "done", "完成");
  }
  replayButton.disabled = false;
});

// Sticky navigation state and section tracking.
const header = document.querySelector(".site-header");
const progressBar = document.querySelector(".scroll-progress span");
const navLinks = [...document.querySelectorAll(".site-nav a")];
const trackedSections = navLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

const refreshHeader = () => {
  header?.classList.toggle("scrolled", window.scrollY > 30);
  const available = document.documentElement.scrollHeight - window.innerHeight;
  const progress = available > 0 ? Math.min(window.scrollY / available, 1) : 0;
  if (progressBar) progressBar.style.transform = `scaleX(${progress})`;
  const marker = window.scrollY + window.innerHeight * 0.35;
  let current = "";
  trackedSections.forEach((section) => {
    if (section.offsetTop <= marker) current = section.id;
  });
  navLinks.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${current}`));
};
window.addEventListener("scroll", refreshHeader, { passive: true });
refreshHeader();

// Mobile navigation.
const menuButton = document.querySelector(".menu-button");
const siteNav = document.querySelector(".site-nav");
menuButton?.addEventListener("click", () => {
  const open = siteNav.classList.toggle("open");
  menuButton.setAttribute("aria-expanded", String(open));
});
navLinks.forEach((link) => link.addEventListener("click", () => {
  siteNav.classList.remove("open");
  menuButton?.setAttribute("aria-expanded", "false");
}));
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !siteNav?.classList.contains("open")) return;
  siteNav.classList.remove("open");
  menuButton?.setAttribute("aria-expanded", "false");
  menuButton?.focus();
});

// Reusable tab controller for capabilities and deployment instructions.
const bindTabs = (buttonSelector, panelSelector, buttonKey, panelKey) => {
  const buttons = [...document.querySelectorAll(buttonSelector)];
  const panels = [...document.querySelectorAll(panelSelector)];
  buttons.forEach((button, index) => {
    button.setAttribute("role", "tab");
    const initiallyActive = button.classList.contains("active");
    button.setAttribute("aria-selected", String(initiallyActive));
    button.tabIndex = initiallyActive ? 0 : -1;
    button.addEventListener("click", () => {
      const selected = button.dataset[buttonKey];
      buttons.forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", String(active));
        item.tabIndex = active ? 0 : -1;
      });
      panels.forEach((panel) => panel.classList.toggle("active", panel.dataset[panelKey] === selected));
    });
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
      const next = buttons[(index + direction + buttons.length) % buttons.length];
      next.focus();
      next.click();
    });
  });
};
bindTabs(".tab-button", ".tab-panel", "tab", "panel");
bindTabs(".deploy-tab", ".deploy-panel", "deploy", "deployPanel");

// Copy buttons used by test fixtures and deployment commands.
const toast = document.querySelector(".toast");
let toastTimer;
const showToast = () => {
  toast?.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast?.classList.remove("show"), 1700);
};

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    const originalLabel = button.textContent;
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      showToast();
    } catch {
      const helper = document.createElement("textarea");
      helper.value = button.dataset.copy;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
      showToast();
    }
    button.textContent = "已复制 ✓";
    setTimeout(() => { button.textContent = originalLabel; }, 1400);
  });
});

// Interactive, deterministic walkthrough for presentations and first-time visitors.
const runDemoButton = document.querySelector("[data-run-demo]");
const demoEvents = [...document.querySelectorAll("[data-demo-event]")];
const consoleProgress = document.querySelector("[data-console-progress]");
const consoleResult = document.querySelector("[data-console-result]");
const consoleClock = document.querySelector("[data-console-clock]");

const resetDemo = () => {
  demoEvents.forEach((event) => {
    event.classList.remove("running", "done");
    event.querySelector("b").textContent = "WAIT";
  });
  if (consoleProgress) consoleProgress.style.width = "0%";
  consoleResult?.classList.remove("show");
  if (consoleResult) consoleResult.hidden = true;
};

runDemoButton?.addEventListener("click", async () => {
  resetDemo();
  runDemoButton.classList.add("running");
  runDemoButton.querySelector("b").textContent = "巡检进行中";
  runDemoButton.querySelector("small").textContent = "请稍候";
  const startedAt = performance.now();
  const clockTimer = setInterval(() => {
    const elapsed = performance.now() - startedAt;
    const seconds = Math.floor(elapsed / 1000).toString().padStart(2, "0");
    const milliseconds = Math.floor(elapsed % 1000).toString().padStart(3, "0");
    if (consoleClock) consoleClock.textContent = `00:${seconds}.${milliseconds}`;
  }, 33);

  for (let index = 0; index < demoEvents.length; index += 1) {
    const event = demoEvents[index];
    event.classList.add("running");
    event.querySelector("b").textContent = "RUN";
    await delay(620 + index * 55);
    event.classList.remove("running");
    event.classList.add("done");
    event.querySelector("b").textContent = "DONE";
    if (consoleProgress) consoleProgress.style.width = `${((index + 1) / demoEvents.length) * 100}%`;
  }

  clearInterval(clockTimer);
  if (consoleResult) consoleResult.hidden = false;
  await delay(20);
  consoleResult?.classList.add("show");
  runDemoButton.classList.remove("running");
  runDemoButton.querySelector("b").textContent = "重新运行演示";
  runDemoButton.querySelector("small").textContent = "结果已重置";
});
