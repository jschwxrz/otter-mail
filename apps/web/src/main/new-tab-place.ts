import { setSyncedPreference } from "./synced-preferences";
export type NewTabPlace = "mail" | "agents" | "calendar";

const KEY = "otter:new-tab-place" as const;

export function getNewTabPlace(): NewTabPlace {
  const value = localStorage.getItem(KEY);
  return value === "agents" || value === "calendar" ? value : "mail";
}

export function setNewTabPlace(place: NewTabPlace): void {
  setSyncedPreference(KEY, place);
}
