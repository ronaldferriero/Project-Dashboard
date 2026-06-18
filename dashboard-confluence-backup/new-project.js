// New Project Form Handler

document.addEventListener('DOMContentLoaded', async () => {
    await checkServerAvailability();
    setupFormHandlers();
});

async function checkServerAvailability() {
    // Check if we're on GitHub Pages or if local server is unavailable
    const isGitHubPages = window.location.hostname.includes('github.io');

    if (isGitHubPages) {
        showError(`
            <strong>⚠️ Local Server Required</strong><br><br>
            This form requires the local Python server to create Confluence pages.<br><br>
            <strong>To use this form:</strong><br>
            1. Clone the repository to your machine<br>
            2. Set up Confluence credentials in .env file<br>
            3. Run: <code>./start_dashboard_server.sh</code><br>
            4. Open: <code>http://127.0.0.1:8765/dashboard/new-project.html</code><br><br>
            See README for full instructions.
        `);
        document.querySelector('.btn-primary').disabled = true;
        return false;
    }

    // Check if local server is responding
    try {
        const response = await fetch('/api/config', { method: 'GET' });
        if (!response.ok) {
            throw new Error('Server not responding');
        }
        return true;
    } catch (error) {
        showError(`
            <strong>⚠️ Local Server Not Running</strong><br><br>
            The dashboard server is not responding. Please start it:<br><br>
            <code>./start_dashboard_server.sh</code><br><br>
            Then refresh this page.
        `);
        document.querySelector('.btn-primary').disabled = true;
        return false;
    }
}

function setupFormHandlers() {
    const form = document.getElementById('projectForm');

    // Handle form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitForm();
    });

    // Auto-uppercase state code
    document.getElementById('regionState').addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase();
    });
}

async function submitForm() {
    const formData = collectFormData();

    // Validate required fields
    if (!formData.projectTitle || !formData.regionState || !formData.hostingType ||
        !formData.projectManager || !formData.implementationManager ||
        !formData.projectStatus || !formData.clientStatus) {
        showError('Please fill in all required fields marked with *');
        return;
    }

    // Show loading indicator
    document.getElementById('loadingIndicator').style.display = 'block';
    document.querySelector('.btn-primary').disabled = true;

    try {
        // Submit to server
        const response = await fetch('/api/create-project-page', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Server returned ${response.status}`);
        }

        const result = await response.json();

        if (result.success) {
            showSuccess(`Project "${formData.projectTitle}" created successfully! <a href="${result.pageUrl}" target="_blank">View page</a><br><br>The project will appear in the dashboard after the next data refresh.`);
            resetForm();
        } else {
            throw new Error(result.error || 'Unknown error occurred');
        }

    } catch (error) {
        console.error('Error creating project:', error);
        showError(`Failed to create project: ${error.message}`);
    } finally {
        document.getElementById('loadingIndicator').style.display = 'none';
        document.querySelector('.btn-primary').disabled = false;
    }
}

function collectFormData() {
    const form = document.getElementById('projectForm');
    const formData = {};

    // Collect all text inputs, textareas, and selects
    const inputs = form.querySelectorAll('input:not([type="checkbox"]), textarea, select');
    inputs.forEach(input => {
        if (input.name) {
            formData[input.name] = input.value;
        }
    });

    // Collect products checkboxes
    const products = [];
    const productCheckboxes = form.querySelectorAll('input[name="products"]:checked');
    productCheckboxes.forEach(checkbox => {
        products.push(checkbox.value);
    });
    formData.products = products;

    return formData;
}

function resetForm() {
    const form = document.getElementById('projectForm');
    form.reset();
    hideMessages();
}

function showSuccess(message) {
    hideMessages();
    const successDiv = document.getElementById('successMessage');
    successDiv.innerHTML = message;
    successDiv.style.display = 'block';
    scrollToTop();
}

function showError(message) {
    hideMessages();
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.innerHTML = message;
    errorDiv.style.display = 'block';
    scrollToTop();
}

function hideMessages() {
    document.getElementById('successMessage').style.display = 'none';
    document.getElementById('errorMessage').style.display = 'none';
}

function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
