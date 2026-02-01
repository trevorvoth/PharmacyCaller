import { AdvancedMarker } from '@vis.gl/react-google-maps';

interface UserLocationMarkerProps {
  position: { lat: number; lng: number };
}

export default function UserLocationMarker({ position }: UserLocationMarkerProps) {
  return (
    <AdvancedMarker position={position} zIndex={200}>
      {/* Blue dot with pulse animation for user location */}
      <div className="relative">
        {/* Outer pulse ring */}
        <div className="absolute inset-0 rounded-full bg-blue-400 opacity-30 animate-ping"
             style={{ width: 32, height: 32, marginLeft: -8, marginTop: -8 }} />

        {/* Accuracy circle (static) */}
        <div
          className="absolute rounded-full bg-blue-100 opacity-40"
          style={{
            width: 48,
            height: 48,
            marginLeft: -16,
            marginTop: -16,
            border: '1px solid rgba(59, 130, 246, 0.3)'
          }}
        />

        {/* Inner dot */}
        <div
          className="relative rounded-full shadow-lg"
          style={{
            width: 16,
            height: 16,
            backgroundColor: '#3B82F6',
            border: '3px solid white',
            boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
          }}
        />
      </div>
    </AdvancedMarker>
  );
}
