// Shared Tyler Forge app-bar/drawer wiring for every dashboard page.
// Loaded as a plain script (not a module) on every page, after
// dashboard/dist/forge-bundle.js and (where present) app.js/alerts.js.

function totalAlertCount(alerts) {
  return (
    alerts.critical.length +
    alerts.warning.length +
    alerts.schedule.length +
    alerts.resource.length +
    alerts.trending.length
  );
}

function redStatusCount(projects) {
  return projects.filter(function (project) {
    return project.project_status === "Red";
  }).length;
}

function setNotificationBadge(notificationButton, count) {
  notificationButton.count = count;
  notificationButton.showBadge = count > 0;
}

function wireMenuButton() {
  var menuButton = document.getElementById("appBarMenuButton");
  var drawer = document.getElementById("appDrawer");
  if (!menuButton || !drawer) return;
  menuButton.addEventListener("click", function () {
    drawer.open = !drawer.open;
  });
}

function wireHelpButton() {
  var helpButton = document.getElementById("appBarHelpButton");
  if (!helpButton) return;
  helpButton.options = [{ label: "About This Dashboard", value: "about" }];
}

function wireNotificationButton() {
  var notificationButton = document.getElementById("alertsNotificationButton");
  if (!notificationButton) return;

  notificationButton.addEventListener("click", function () {
    window.location.href = "./risk.html#alerts";
  });

  if (typeof categorizeAlerts === "function") {
    window.addEventListener("dashboardReady", function () {
      setNotificationBadge(notificationButton, totalAlertCount(categorizeAlerts()));
    });
  } else {
    fetch("./data/projects.json")
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        var projects = (data && data.projects) || [];
        setNotificationBadge(notificationButton, redStatusCount(projects));
      })
      .catch(function () {
        /* Leave the badge unset if the fetch fails. */
      });
  }
}

function initAppShell() {
  wireMenuButton();
  wireHelpButton();
  wireNotificationButton();
}

// Runs immediately (not deferred to DOMContentLoaded): this script tag is
// placed at the end of <body>, so the app-bar/drawer elements it wires up
// already exist by the time it executes. Deferring to DOMContentLoaded
// previously lost a race against app.js's async init(), which can dispatch
// dashboardReady before DOMContentLoaded fires.
if (typeof document !== "undefined") {
  initAppShell();
}
