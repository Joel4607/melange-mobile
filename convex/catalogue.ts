import { v } from 'convex/values';
import { query } from './_generated/server';

// Public service information only. Customer records will require authentication.
export const list = query({
  args: {},
  returns: v.array(v.object({ id: v.string(), name: v.string(), icon: v.string(), color: v.string(), description: v.string(), example: v.string() })),
  handler: async () => [
    { id: 'groceries', name: 'Grocery shopping', icon: '🥬', color: '#EBF0D9', description: 'The everyday essentials, picked up with care.', example: 'Tomatoes, onions, plantain and a loaf of bread.' },
    { id: 'food', name: 'Food pickup', icon: '🥡', color: '#FBE8D5', description: 'Your favourite meal, without the extra trip.', example: 'Collect my lunch order and bring it to my office.' },
    { id: 'pharmacy', name: 'Pharmacy pickup', icon: '💊', color: '#F0E6EF', description: 'Collect an order you have arranged with your pharmacy.', example: 'Pick up my prepared pharmacy order.' },
    { id: 'delivery', name: 'Pickup & delivery', icon: '📦', color: '#E1EBEF', description: 'A parcel, a document, or something you left behind.', example: 'Collect a sealed parcel and deliver it across town.' },
    { id: 'market', name: 'Market run', icon: '🛍', color: '#F7E7CE', description: 'A helping hand with your market shopping list.', example: 'Buy the items on my list from Osu market.' },
    { id: 'other', name: 'Something else', icon: '✨', color: '#E9E9E2', description: 'For the little tasks that do not fit a category.', example: 'Collect my clothes from the laundry.' },
  ],
});
