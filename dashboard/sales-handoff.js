// Sales Handoff Form Handler
console.log('Sales Handoff JS loaded - version 2.0');

let projectsData = [];

// Load projects on page load
document.addEventListener('DOMContentLoaded', async () => {
    await checkServerAvailability();
    await loadProjects();
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
            4. Open: <code>http://127.0.0.1:8765/dashboard/sales-handoff.html</code><br><br>
            See SALES_HANDOFF_README.md for full instructions.
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

async function loadProjects() {
    try {
        const response = await fetch('data/projects.json');
        const data = await response.json();
        projectsData = data.projects || [];

        populateProjectSelector();
    } catch (error) {
        console.error('Error loading projects:', error);
        showError('Failed to load projects. Please refresh the page.');
    }
}

function populateProjectSelector() {
    const select = document.getElementById('projectSelect');

    // Sort projects alphabetically by title
    const sortedProjects = [...projectsData].sort((a, b) =>
        a.title.localeCompare(b.title)
    );

    sortedProjects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.page_id;
        option.textContent = project.title;
        option.dataset.projectData = JSON.stringify(project);
        select.appendChild(option);
    });
}

function setupFormHandlers() {
    const form = document.getElementById('handoffForm');
    const projectSelect = document.getElementById('projectSelect');

    // Pre-fill basic info when project is selected
    projectSelect.addEventListener('change', (e) => {
        if (e.target.value) {
            const selectedOption = e.target.options[e.target.selectedIndex];
            const projectData = JSON.parse(selectedOption.dataset.projectData || '{}');
            prefillFormFromProject(projectData);
        }
    });

    // Handle form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitForm();
    });
}

function prefillFormFromProject(project) {
    // Pre-fill fields that we can extract from project data
    document.getElementById('clientName').value = project.title || '';
    document.getElementById('hostingType').value = project.hosting_type || '';
    document.getElementById('currentProducts').value =
        Array.isArray(project.contracted_products)
            ? project.contracted_products.join('\n')
            : '';

    // Pre-fill PM name if available
    const pmNameInput = document.querySelector('input[name="attendee_pm_name"]');
    if (pmNameInput && project.project_manager) {
        pmNameInput.value = project.project_manager;
    }

    // Pre-fill IM name if available
    const imNameInput = document.querySelector('input[name="attendee_implManager_name"]');
    if (imNameInput && project.implementation_manager) {
        imNameInput.value = project.implementation_manager;
    }
}

async function submitForm() {
    const projectSelect = document.getElementById('projectSelect');
    const projectId = projectSelect.value;

    if (!projectId) {
        showError('Please select a project first.');
        return;
    }

    const formData = collectFormData();
    const selectedOption = projectSelect.options[projectSelect.selectedIndex];
    const projectTitle = selectedOption.textContent;

    // Show loading indicator
    document.getElementById('loadingIndicator').style.display = 'block';
    document.querySelector('.btn-primary').disabled = true;

    try {
        // Submit to server
        const response = await fetch('/api/create-handoff-page', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                projectId: projectId,
                projectTitle: projectTitle,
                formData: formData
            })
        });

        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.success) {
            showSuccess(`Sales Handoff document created successfully for ${projectTitle}! <a href="${result.pageUrl}" target="_blank">View page</a>`);
            resetForm();
        } else {
            throw new Error(result.error || 'Unknown error occurred');
        }

    } catch (error) {
        console.error('Error submitting form:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack
        });
        showError(`Failed to create handoff document: ${error.message}`);
    } finally {
        document.getElementById('loadingIndicator').style.display = 'none';
        document.querySelector('.btn-primary').disabled = false;
    }
}

function collectFormData() {
    const form = document.getElementById('handoffForm');
    const formData = {};

    // Collect all form inputs
    const inputs = form.querySelectorAll('input, textarea, select');
    inputs.forEach(input => {
        if (input.name) {
            // Handle checkboxes specially
            if (input.type === 'checkbox') {
                formData[input.name] = input.checked;
            } else {
                formData[input.name] = input.value;
            }
        }
    });

    // Organize attendees into structured data
    formData.attendees = [
        {
            title: 'Sales Rep',
            name: formData.attendee_salesRep_name || '',
            notes: formData.attendee_salesRep_notes || ''
        },
        {
            title: 'Solution Consultant (optional)',
            name: formData.attendee_solutionConsultant_name || '',
            notes: formData.attendee_solutionConsultant_notes || ''
        },
        {
            title: 'Implementation Manager',
            name: formData.attendee_implManager_name || '',
            notes: formData.attendee_implManager_notes || ''
        },
        {
            title: 'Project Manager',
            name: formData.attendee_pm_name || '',
            notes: formData.attendee_pm_notes || ''
        },
        {
            title: 'Consultant',
            name: formData.attendee_consultant_name || '',
            notes: formData.attendee_consultant_notes || ''
        },
        {
            title: 'Other',
            name: formData.attendee_other_name || '',
            notes: formData.attendee_other_notes || ''
        }
    ];

    // Organize contacts into structured data
    formData.contacts = [];
    for (let i = 1; i <= 5; i++) {
        const contact = {
            name: formData[`contact_${i}_name`] || '',
            email: formData[`contact_${i}_email`] || '',
            department: formData[`contact_${i}_dept`] || '',
            clientRole: formData[`contact_${i}_clientRole`] || '',
            projectRole: formData[`contact_${i}_projectRole`] || ''
        };

        // Only include contacts with at least a name
        if (contact.name) {
            formData.contacts.push(contact);
        }
    }

    return formData;
}

function resetForm() {
    const form = document.getElementById('handoffForm');
    form.reset();
    document.getElementById('projectSelect').value = '';
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
