export type CareValidateSubmitter = {
  id?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  state?: string;
  postalCode?: string;
};

export type CareValidatePayment = {
  id: string;
  amount?: string | number;
  status?: string;
  paymentDate?: string | null;
  description?: string;
};

export type CareValidateCase = {
  id: string;
  referralCode?: string | null;
  submitter?: CareValidateSubmitter;
  promoCode?: string | null;
  promoCodes?: Record<string, string> | string[] | null;
};

export type CareValidateWebhookPayload = {
  event: string;
  payload?: {
    case?: CareValidateCase;
    payment?: CareValidatePayment;
    activity?: {
      type?: string;
      valueAfter?: string | null;
    };
    promoCode?: string | null;
    promoCodes?: Record<string, string> | string[] | null;
  };
};
