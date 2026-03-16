// ---- Config ----
const API_BASE_URL = 'https://kommodo-api.osama-abdullah.com';

// ---- Element Selectors ----
const videoCaptureForm = document.getElementById('videoCaptureForm');
const captureButton = document.getElementById('captureButton');
const buttonText = captureButton.querySelector('span');
const loaderContainer = document.getElementById('loaderContainer');
const resultsSection = document.getElementById('downloadResults');
const videoUrlInput = document.getElementById('videoUrlInput');
const thumbnailContainer = resultsSection.querySelector('.thumbnail-container');
const downloadLinkButton = resultsSection.querySelector('.download-button');

let capturedVideoUrl = '';

// ---- Helpers ----
const scrollToElement = (element) => {
  if (element) element.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const toggleLoading = (isLoading) => {
  captureButton.disabled = isLoading;
  if (isLoading) {
    buttonText.innerHTML = '<span class="spinner"></span> Processing...';
    loaderContainer.style.display = 'flex';
    resultsSection.classList.remove('visible');
    scrollToElement(loaderContainer);
  } else {
    buttonText.textContent = 'Download Video';
    loaderContainer.style.display = 'none';
  }
};

const toggleResults = (show) => {
  resultsSection.classList.toggle('visible', show);
  if (show) scrollToElement(resultsSection);
};

const updateResultsDOM = (data) => {
  if (data.poster) {
    thumbnailContainer.innerHTML = `<img src="${data.poster}" alt="Video Thumbnail">`;
  } else {
    thumbnailContainer.innerHTML = '';
  }
};

// ---- Main Event Handlers ----
const handleCaptureVideo = async (event) => {
  event.preventDefault();

  const videoUrl = videoUrlInput.value.trim();
  if (!videoUrl) {
    alert('Please enter a video URL.');
    return;
  }

  toggleLoading(true);

  try {
    const response = await fetch(`${API_BASE_URL}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: videoUrl })
    });

    const data = await response.json();

    if (response.ok && data.status === 'ok') {
      capturedVideoUrl = data.videoUrl;
      updateResultsDOM(data);
      toggleResults(true);
    } else {
      const message = data.message || data.error || 'Failed to capture video.';
      alert(`Error: ${message}`);
      console.error('[API Error]', message);
      toggleResults(false);
    }

  } catch (error) {
    alert('Network error. Please try again.');
    console.error('[Network Error]', error);
    toggleResults(false);
  } finally {
    toggleLoading(false);
  }
};

const handleDownloadVideo = () => {
  if (!capturedVideoUrl) {
    alert('No video captured yet.');
    return;
  }

  const a = document.createElement('a');
  a.href = `${API_BASE_URL}/download?playlist=${encodeURIComponent(capturedVideoUrl)}`;
  a.download = 'video.ts';
  document.body.appendChild(a);
  a.click();
  a.remove();
};

// ---- Event Listeners ----
videoCaptureForm.addEventListener('submit', handleCaptureVideo);
downloadLinkButton.addEventListener('click', handleDownloadVideo);

// ---- Initial State ----
toggleResults(false);