// Portfolio home: update data stamp from projects.json.
// Kept separate from app.js so the welcome page does not run table/filter init.

function setStamp(message) {
  var element = document.getElementById("stamp");
  if (element) {
    element.textContent = message;
  }
}

function initHome() {
  return fetch("./data/projects.json", { cache: "no-store" })
    .then(function (response) {
      if (!response.ok) {
        throw new Error("Failed to load projects.json (" + response.status + ")");
      }
      return response.json();
    })
    .then(function (payload) {
      var projects = (payload && payload.projects) || [];
      var generatedAt = payload && payload.generated_at;
      setStamp(
        generatedAt
          ? "Data as of " + generatedAt
          : "Loaded " + projects.length + " active projects."
      );
    })
    .catch(function (error) {
      setStamp(
        "Dashboard data not loaded: " +
          (error && error.message ? error.message : "unknown error")
      );
    });
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  initHome();
}
