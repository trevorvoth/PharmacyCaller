import { useParams } from 'react-router-dom';

export default function CallPage() {
  const { callId } = useParams<{ callId: string }>();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
        Call: {callId}
      </h1>
      <p className="text-gray-500 dark:text-gray-400 mt-2">
        Call interface will be implemented in Batch 9.
      </p>
    </div>
  );
}
