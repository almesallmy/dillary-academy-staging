import axios from 'axios';
import { toTitleCase } from '@/utils/formatters';

/** Create user */
const postUser = async (body) => {
  body.firstName = toTitleCase(body.firstName);
  body.lastName = toTitleCase(body.lastName);
  const response = await axios.post('/api/sign-up', body);
  return response;
};

/** Get all users (PII — admin-only views should guard on server) */
const getUsers = async () => {
  const response = await axios.get('/api/users');
  return response;
};

/** Get single user by query string (_id | email | whatsapp) */
const getUser = async (query = '') => {
  const response = await axios.get(`/api/user?${query}`);
  return response;
};

/** Update user document */
const updateUser = async (userId, userData) => {
  if (Object.hasOwn(userData, 'firstName')) userData.firstName = toTitleCase(userData.firstName);
  if (Object.hasOwn(userData, 'lastName'))  userData.lastName  = toTitleCase(userData.lastName);
  if (Object.hasOwn(userData, 'gender'))    userData.gender    = userData.gender.toLowerCase();
  const { data } = await axios.put(`/api/user/${userId}`, userData);
  return data;
};

/**
 * NEW: Paginated admin fetch that returns students WITH their class objects in one call.
 * Backend: GET /api/students-with-classes?limit=100&page=1
 */
const getStudentsWithClasses = async ({ page = 1, limit = 100 } = {}) => {
  const { data } = await axios.get('/api/students-with-classes', {
    params: { page, limit },
  });
  return data; // { items, total, page, limit }
};

/**
 * DEPRECATED: N+1 per-student fetch (kept for backward-compat while migrating UI).
 * Prefer getStudentsWithClasses().
 */
const getStudentsClasses = async (studentId) => {
  const { data } = await axios.get(`/api/students-classes/${studentId}`);
  return data;
};

const getStudentsForExport = async () => {
  const { data } = await axios.get('/api/students-export');
  return data;
};

const deleteUser = async (userId) => {
  const { data } = await axios.delete(`/api/user/${userId}`);
  return data;
};

export {
  postUser,
  getUsers,
  getUser,
  updateUser,
  getStudentsWithClasses, // <- use this in Admin/Students
  getStudentsClasses,     // deprecated
  getStudentsForExport,
  deleteUser,
};