import { SearchBar } from '../SearchBar';

export default function SearchBarExample() {
  return (
    <div className="p-4 max-w-md">
      <SearchBar onSearch={(q) => console.log('Search:', q)} />
    </div>
  );
}
