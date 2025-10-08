import { PersonAvatar } from '../PersonAvatar';

export default function PersonAvatarExample() {
  return (
    <div className="flex gap-4 items-center p-4">
      <PersonAvatar name="John Doe" size="sm" />
      <PersonAvatar name="Jane Smith" size="md" />
      <PersonAvatar name="Bob Johnson" size="lg" />
    </div>
  );
}
