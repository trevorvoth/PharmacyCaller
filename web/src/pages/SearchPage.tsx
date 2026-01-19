import { useParams } from 'react-router-dom';

export default function SearchPage() {
  const { searchId } = useParams<{ searchId: string }>();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
        Search: {searchId}
      </h1>
      <p className="text-gray-500 dark:text-gray-400 mt-2">
        Search details will be implemented in Batch 8.
      </p>
    </div>
  );
}
