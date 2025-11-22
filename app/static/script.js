const form = document.getElementById("downloadForm");
const button = document.getElementById("downloadButton");
const buttonText = button.querySelector("span");
const loaderContainer = document.getElementById("loaderContainer");
const resultsSection = document.getElementById("downloadResults");

// Function to smoothly scroll to an element
const scrollToElement = (element) => {
  if (element) {
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  }
};

// Initially hide the results section using the visible class removal
resultsSection.classList.remove("visible");

form.addEventListener("submit", function (event) {
  // 1. Prevent default form submission
  event.preventDefault();

  // Hide any previous results
  resultsSection.classList.remove("visible");

  // 2. Start Loading State (Button Spin & Loader Appear)
  button.disabled = true;
  buttonText.innerHTML = '<span class="spinner"></span> Processing...';
  loaderContainer.style.display = "flex"; // Show loader

  // Scroll down immediately to show the loader is active
  scrollToElement(loaderContainer);

  // 3. Simulate Backend Processing (2.5 seconds delay)
  setTimeout(() => {
    // 4. End Loading State (Success/Results Appear)
    button.disabled = false;
    buttonText.textContent = "Download Video";
    loaderContainer.style.display = "none"; // Hide loader

    // Show results section
    resultsSection.classList.add("visible");

    // Scroll down again to ensure the video results are clearly visible
    scrollToElement(resultsSection);
  }, 2500); // 2.5 second simulation delay
});
