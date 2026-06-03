import { apiFetch } from "./config";

const A = "/api/admin";

export const getAdminStats = () => apiFetch(`${A}/stats`);
export const getAdminUsers = (params = {}) => apiFetch(`${A}/users?${new URLSearchParams(params)}`);
export const deleteAdminUser = (id) => apiFetch(`${A}/users/${id}`, { method: "DELETE" });
export const getAdminBoards = (params = {}) => apiFetch(`${A}/boards?${new URLSearchParams(params)}`);
export const deleteAdminBoard = (id) => apiFetch(`${A}/boards/${id}`, { method: "DELETE" });
export const getAdminLive = () => apiFetch(`${A}/live`);
