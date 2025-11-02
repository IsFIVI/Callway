//Frontend static animatitions JS
// Floating Navigation Script
window.addEventListener("scroll", () => {
  const floatingNav = document.getElementById("floatingNav");
  const scrollPosition = window.scrollY;
  const triggerPoint = 50;

  if (scrollPosition > triggerPoint) {
    floatingNav.classList.add("show");
  } else {
    floatingNav.classList.remove("show");
  }
});

// Mobile Navigation Toggle
document.addEventListener("DOMContentLoaded", () => {
  const mobileNavToggle = document.getElementById("mobileNavToggle");
  const mobileNavMenu = document.getElementById("mobileNavMenu");

  if (!mobileNavToggle || !mobileNavMenu) {
    return;
  }

  const setMenuState = (isOpen) => {
    mobileNavToggle.setAttribute("aria-expanded", String(isOpen));
    mobileNavToggle.classList.toggle("is-open", isOpen);
    mobileNavMenu.classList.toggle("open", isOpen);
  };

  mobileNavToggle.addEventListener("click", () => {
    const isOpen = mobileNavToggle.getAttribute("aria-expanded") === "true";
    setMenuState(!isOpen);
  });

  mobileNavMenu.querySelectorAll("a, button").forEach((item) => {
    item.addEventListener("click", () => setMenuState(false));
  });

  document.addEventListener("click", (event) => {
    const isToggle = mobileNavToggle.contains(event.target);
    const isMenu = mobileNavMenu.contains(event.target);
    const isOpen = mobileNavToggle.getAttribute("aria-expanded") === "true";

    if (!isOpen || isToggle || isMenu) {
      return;
    }

    setMenuState(false);
  });

  document.addEventListener("keydown", (event) => {
    const isOpen = mobileNavToggle.getAttribute("aria-expanded") === "true";

    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      setMenuState(false);
      mobileNavToggle.focus();
    }
  });
});

// Animated Dots Background Script
function createDotsBackground(containerId, sectionId) {
  const dotsContainer = document.getElementById(containerId);
  const section = document.getElementById(sectionId);

  if (!dotsContainer || !section) return;

  // Calculate number of dots based on container size
  const containerWidth = section.offsetWidth;
  const containerHeight = section.offsetHeight;

  const dotSize = 13; // 13px
  const spacing = 4; // 4px gap
  const totalDotSpace = dotSize + spacing;

  const dotsPerRow = Math.floor(containerWidth / totalDotSpace);
  const dotsPerColumn = Math.floor(containerHeight / totalDotSpace);
  // --- Centrage horizontal/vertical de la grille ---
  const gridWidth = (dotsPerRow - 1) * totalDotSpace + dotSize;
  const gridHeight = (dotsPerColumn - 1) * totalDotSpace + dotSize;
  const offsetX = Math.max(0, Math.floor((containerWidth - gridWidth) / 2));
  const offsetY = Math.max(0, Math.floor((containerHeight - gridHeight) / 2));

  // Clear existing dots
  dotsContainer.innerHTML = "";

  // Create dots with individual timers
  const dots = [];
  for (let row = 0; row < dotsPerColumn; row++) {
    for (let col = 0; col < dotsPerRow; col++) {
      const dot = document.createElement("div");
      dot.className = "dot";
      dot.style.left = offsetX + col * totalDotSpace + "px";
      dot.style.top = offsetY + row * totalDotSpace + "px";

      // Give each dot its own independent timer and random delay
      dot.nextChangeTime = Date.now() + Math.random() * 2000; // Random initial delay up to 2 seconds
      dot.changeInterval = 800 + Math.random() * 1200; // Random interval between 800-2000ms

      dotsContainer.appendChild(dot);
      dots.push(dot);
    }
  }

  // Track active dots for maximum limit
  let activeDots = 0;
  const maxActiveDots = Math.floor(dots.length * 0.05); // Maximum 5% of dots active

  // Animate each dot independently
  function animateDots() {
    const currentTime = Date.now();

    // Shuffle the dots array to avoid processing in order
    const shuffledDots = [...dots].sort(() => Math.random() - 0.5);

    shuffledDots.forEach((dot) => {
      // Check if it's time for this dot to potentially change
      if (currentTime >= dot.nextChangeTime) {
        // Each dot has its own independent random chance
        const randomChance = Math.random();

        if (dot.classList.contains("active")) {
          // Active dot has a chance to deactivate
          if (randomChance < 0.3) {
            // 30% chance to turn off
            dot.classList.remove("active");
            activeDots--;
          }
        } else {
          // Inactive dot has a chance to activate (if under limit)
          if (randomChance < 0.15 && activeDots < maxActiveDots) {
            // 15% chance to turn on
            dot.classList.add("active");
            activeDots++;
          }
        }

        // Set next change time with individual randomization
        dot.nextChangeTime =
          currentTime + dot.changeInterval + (Math.random() * 500 - 250);
      }
    });
  }

  // Start animation with high frequency for smooth independent changes
  setInterval(animateDots, 50);

  // Initially activate some random dots
  const initialActiveDots = Math.floor(dots.length * 0.03);
  const shuffledInitialDots = [...dots].sort(() => Math.random() - 0.5);

  for (let i = 0; i < initialActiveDots; i++) {
    shuffledInitialDots[i].classList.add("active");
    activeDots++;
  }
}

// Initialize dots backgrounds when page loads
window.addEventListener("load", () => {
  createDotsBackground("dotsBackground", "hero");
  createDotsBackground("featuresDotsBackground", "features");
  createDotsBackground("reasonsDotsBackground", "reasons-choose");
  createDotsBackground("pricingDotsBackground", "pricing")
});

// Recreate dots on window resize
window.addEventListener("resize", () => {
  createDotsBackground("dotsBackground", "hero");
  createDotsBackground("featuresDotsBackground", "features");
  createDotsBackground("reasonsDotsBackground", "reasons-choose");
  createDotsBackground("pricingDotsBackground", "pricing")
});
