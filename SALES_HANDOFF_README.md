# Sales Handoff Document Tab

## Overview

A new "Sales Handoff" tab has been added to the dashboard that allows users to create Sales & Client Handoff Information pages in Confluence for projects. This form streamlines the knowledge transfer from Account Executives to the Professional Services team.

## Features

- **Project Selector**: Choose from any active project in the dashboard
- **Auto-Fill**: Basic project information (client name, hosting type, PM, IM) is pre-filled when you select a project
- **Comprehensive Form**: Includes all sections from the standard Sales Handoff template:
  - Basic Information (client details, contract info, hosting)
  - Sales Handoff Attendees (sales rep, PM, IM, consultants)
  - Client & 3rd Party Contacts (up to 5 contacts with full details)
  - Additional Information (business drivers, competitors, expectations, etc.)
  
## How to Use

1. **Navigate** to the Sales Handoff tab from any dashboard page
2. **Select a Project** from the dropdown (sorted alphabetically)
3. **Fill out the form** - required fields and pre-filled data are marked
4. **Submit** - the form creates a child page under the selected project in Confluence

## What Happens on Submit

1. Form data is sent to the local dashboard server
2. Server creates a new Confluence page titled: `{Project Name} - Sales & Client Handoff Information`
3. Page is created as a child of the selected project page in the EPLPS space
4. User receives a success message with a link to view the new page
5. Form is cleared and ready for the next submission

## Form Does Not Save Data

**Important**: This tab is designed as a submission form only. It does not:
- Save form data locally
- Keep a history of submitted forms
- Allow editing of previously submitted forms

Each submission creates a NEW page in Confluence. If you need to update an existing handoff document, edit it directly in Confluence.

## Testing Without Creating Pages

If you want to test the form without actually creating Confluence pages, you can:
1. Fill out the form completely
2. Check browser console for the payload being sent
3. The server will attempt to create the page (you'll need valid Confluence credentials)

## Example Projects with Existing Handoff Pages

Some projects already have Sales Handoff subpages that you can reference:
- **Randolph County, NC** - Has a complete handoff document with all sections filled

## Technical Details

### Files Created
- `/dashboard/sales-handoff.html` - Form interface
- `/dashboard/sales-handoff.js` - Form logic and submission handler
- `/dashboard_server.py` - Added `/api/create-handoff-page` endpoint

### API Endpoint
- **URL**: `POST /api/create-handoff-page`
- **Payload**:
  ```json
  {
    "projectId": "page_id_from_confluence",
    "projectTitle": "Project Name",
    "formData": {
      "clientName": "...",
      "attendees": [...],
      "contacts": [...],
      ...
    }
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "pageId": "new_page_id",
    "pageUrl": "https://tylertech.atlassian.net/wiki/...",
    "message": "Sales handoff page created successfully"
  }
  ```

## Future Enhancements (Optional)

If you want to keep this feature, consider:
- [ ] Add validation to prevent duplicate handoff pages for the same project
- [ ] Add ability to check if a handoff page already exists
- [ ] Add "Save Draft" functionality (would need backend storage)
- [ ] Add file upload support for demo recordings or RFP responses
- [ ] Add email notifications when handoff documents are created

## To Remove This Feature

If you decide to scrap this feature:
1. Delete `/dashboard/sales-handoff.html`
2. Delete `/dashboard/sales-handoff.js`
3. Remove the `/api/create-handoff-page` endpoint from `dashboard_server.py`
4. Remove the "Sales Handoff" link from all dashboard HTML files
5. Delete this README

## Notes

- The form structure matches the existing Sales Handoff template used at Tyler Technologies
- All form fields are optional (no hard validation) since not all information may be available at handoff time
- The form uses Confluence's storage format for page content to ensure proper rendering
- Panel macros are used to organize sections visually in Confluence
