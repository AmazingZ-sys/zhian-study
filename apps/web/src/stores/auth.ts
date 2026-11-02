import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { User, Profile } from '@zhian/contracts';
import { api } from '../api';
export const useAuth = defineStore('auth', () => {
  const user = ref<User | null>(null),
    profile = ref<Profile | null>(null),
    initialized = ref(false);
  async function load() {
    try {
      const { data } = await api.get('/users/me');
      user.value = data.data.user;
      profile.value = data.data.profile;
    } catch (e) {
      if ((e as { status?: number }).status === 401) {
        user.value = null;
        profile.value = null;
      } else throw e;
    } finally {
      initialized.value = true;
    }
  }
  async function login(input: { email: string; password: string; name?: string }, register = false) {
    const { data } = await api.post(register ? '/auth/register' : '/auth/login', { ...input, client: 'web' });
    user.value = data.data.user;
    await load();
  }
  async function logout() {
    await api.post('/auth/logout');
    user.value = null;
    profile.value = null;
  }
  return { user, profile, initialized, load, login, logout };
});
