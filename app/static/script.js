// 1. Element Selector Setup (ensure these IDs match your HTML, using semantic names)
const videoCaptureForm = document.getElementById('videoCaptureForm');
const captureButton = document.getElementById('captureButton');
const buttonText = captureButton.querySelector('span');
const loaderContainer = document.getElementById('loaderContainer');
const resultsSection = document.getElementById('downloadResults');
const videoUrlInput = document.getElementById('videoUrlInput');

// Selectors for dynamic content updates
const videoContainer = resultsSection.querySelector('.video-container');
const detailItems = resultsSection.querySelectorAll('.detail-item span');
const downloadLinkButton = resultsSection.querySelector('.download-button');

// Helper for smooth scrolling
const scrollToElement = (element) => {
    if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
};

// UI State Management Functions (toggleLoading and toggleResults remain the same)
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

const toggleResults = (showSuccess) => {
    if (showSuccess) {
        resultsSection.classList.add('visible');
        scrollToElement(resultsSection);
    } else {
        resultsSection.classList.remove('visible');
    }
};

// 3. Dynamic DOM Update Function
const updateResultsDOM = (data) => {
    const details = data.video_details;
    
    // 1. Video Player & Thumbnail
    const videoHTML = `
        <video controls poster="${data.thumbnail || ''}" style="width: 100%; height: 100%;">
            <source src="${data.stream_path}" type="video/mp4">
            Your browser does not support the video tag.
        </video>
    `;
    videoContainer.innerHTML = videoHTML;

    // 2. Video Details
    const detailMapping = [
        { label: 'File Name', value: data.title + '.' + (details.format.toLowerCase() || 'mp4') },
        { label: 'Format', value: details.format || 'N/A' },
        { label: 'Resolution', value: details.resolution || 'N/A' },
        { label: 'Size', value: details.filesize || 'N/A' },
        { label: 'Duration', value: details.duration || 'N/A' },
    ];

    // This assumes the order of 'detail-item span' elements in HTML matches 'detailMapping' order
    detailItems.forEach((span, index) => {
        span.textContent = detailMapping[index]?.value || 'N/A';
    });

    // 3. Download Button Link (assuming the last detail item is the button)
    downloadLinkButton.setAttribute('onclick', `window.location.href='${data.download_route}'`);
    downloadLinkButton.textContent = `Download Now`;
};

// 4. Main Event Handler
const handleCaptureVideo = async (event) => {
    event.preventDefault();

    const videoUrl = videoUrlInput.value;
    const formAction = videoCaptureForm.action; // Get URL from form action
    
    if (!videoUrl) {
        console.error('Validation Error: URL is required.');
        return; 
    }

    toggleLoading(true);

    // Prepare form data for POST request (matching Python's request.form)
    const formData = new FormData();
    formData.append('url', videoUrl);

    try {
        // Using fetch API for asynchronous call
        const response = await fetch(formAction, {
            method: 'POST',
            body: formData 
        });

        const data = await response.json();

        if (response.ok && !data.error) {
            // Success path
            console.log('[SUCCESS] Video info received.', data);
            updateResultsDOM(data);
            toggleResults(true);
        } else {
            // Handle API error (e.g., video not found, protected)
            const errorMessage = data.error || 'Failed to capture video.';
            alert(`Error: ${errorMessage}`);
            console.error('[API Error]', errorMessage);
            // NOTE: Implement a dedicated error display in the UI here
        }

    } catch (error) {
        // Handle network or unexpected errors
        console.error('[Network Error]', error);
    } finally {
        // Ensure loading state is always turned off
        toggleLoading(false);
    }
};

// 5. Attach Event Listener
videoCaptureForm.addEventListener('submit', handleCaptureVideo);

// Initial state
toggleResults(false);