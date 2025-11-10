import { useState, useEffect, useRef, Children, isValidElement, cloneElement } from 'react';
import { IoChevronDownOutline } from "react-icons/io5";

const Dropdown = ({ label, children, buttonClassName = "text-right" }) => {
  const dropdownRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  // Enhance children so selecting an item closes the dropdown
  const enhancedChildren = Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    const originalOnClick = child.props.onClick;
    return cloneElement(child, {
      onClick: (e) => {
        try {
          originalOnClick?.(e);
        } finally {
          setIsOpen(false);
        }
      },
    });
  });

  return (
    <div ref={dropdownRef} className="relative sm:w-auto w-full">
      {/* dropdown button */}
      <button
        className={`box-border flex items-center h-full bg-white ${buttonClassName}`}
        onClick={() => setIsOpen((v) => !v)}
        type="button"
        aria-expanded={isOpen}
      >
        {label}
        <IoChevronDownOutline
          className={`h-4 w-4 text-black transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* dropdown */}
      {isOpen && (
        <div className="absolute mt-2 w-full rounded-md shadow-lg bg-white z-50 outline outline-white">
          <div className="py-1 flex flex-col" role="menu" aria-orientation="vertical">
            {enhancedChildren}
          </div>
        </div>
      )}
    </div>
  );
};

export default Dropdown;