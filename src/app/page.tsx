import { redirect } from 'next/navigation';

export default function Home() {
  // Directly route users to the generic login page
  redirect('/login');
}
