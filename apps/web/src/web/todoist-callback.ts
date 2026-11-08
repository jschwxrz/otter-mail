if (window.opener) {
  window.opener.postMessage({ type: "otter:todoist-sign-in", url: location.href }, location.origin);
  history.replaceState(null, "", location.pathname);
  document.getElementById("status")!.textContent = "You can close this window and return to Otter.";
} else {
  history.replaceState(null, "", location.pathname);
  document.getElementById("status")!.textContent =
    "Return to Otter and start Todoist sign-in again.";
}
