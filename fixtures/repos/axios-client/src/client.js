import axios from 'axios';
export const removeUser = (id) => axios.delete('/users/' + id);
