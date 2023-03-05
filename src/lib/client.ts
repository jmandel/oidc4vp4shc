export interface PresentationDefinition {
  id: string;
  input_descriptors: {
    id: string;
    name: string;
    purpose?: string;
    format: {
      shc_vc: {
        alg: ["ES256"];
      };
    };
    constraints: {
      fhirVersion: string | string[]; // versions, with "*" allowed as in "4.0.*" or "4.*"
      fhirBundleContains: {
        resourceType: string;
        profile?: string[];
      }[];
      optional: boolean;
      // ["Patient", "Coverage"]
      // ["http://hl7.org/fhir/us/insurance-card/StructureDefinition/C4DIC-Coverage"]
    };
  }[];
}

export interface VP_Request {
  presentation_definition?: PresentationDefinition;
  presentation_definition_uri?: string;
  scope?: string;
  nonce: string;
  client_id: string;
  redirect_uri: string; // must match client_id
  client_metadata: {
    vp_formats: {
      jwt_vp_json: {
        alg: ["none"];
      };
      shc_vc: {
        alg: ["ES256"];
      };
    };
  };
  response_type: "vp_token";
}

export interface VP_Token_Payload {
  iss: string;
  jti: string;
  aud: string;
  nbf: number;
  iat: number;
  exp: number;
  nonce: string;
  vp: {
    "@context": ["https://www.w3.org/2018/credentials/v1"];
    type: ["VerifiablePresentation"];
    verifiableCredential: string[];
  };
}

const digitalInsurancePresentationDefinition: PresentationDefinition = {
  id: "https://smarthealth.cards/scope#insurance",
  input_descriptors: [
    {
      id: "insurance",
      name: "SMART Health Insurance Card",
      purpose: "Access Health Insurance Card", // this should not be hard-coded into a static presentation definition
      format: {
        shc_vc: {
          alg: ["ES256"],
        },
      },
      constraints: {
        fhirVersion: ["4.*"],
        fhirBundleContains: [
          {
            resourceType: "Patient",
          },
          {
            resourceType: "Coverage",
          },
        ],
        optional: false,
      },
    },
  ],
};

const covidVaccinePresentationDefinition: PresentationDefinition = {
  id: "https://smarthealth.cards/scope#covid-vaccine",
  input_descriptors: [
    {
      id: "covid-vaccine",
      name: "COVID-19 Vaccine Card",
      purpose: "Access COVID-19 Vaccine Card", // this should not be hard-coded into a static presentation definition
      format: {
        shc_vc: {
          alg: ["ES256"],
        },
      },
      constraints: {
        fhirVersion: ["4.*"],
        fhirBundleContains: [
          {
            resourceType: "Patient",
          },
          {
            resourceType: "Observation",
            profile: [
              "http://hl7.org/fhir/uv/shc-vaccination/StructureDefinition/shc-vaccination-ad",
            ],
          },
        ],
        optional: false,
      },
    },
  ],
};

const scopes: Record<string, PresentationDefinition> = Object.fromEntries(
  [
    digitalInsurancePresentationDefinition,
    covidVaccinePresentationDefinition,
  ].map((d) => [d.id, d])
);

/*

SHC Feature:

 * Adds format: shc_vc
 * Add constraints.fhirVersion, constraints.fhirBundle

*/

import * as jose from "npm:jose";
import queryString from "npm:query-string";

let serverConfig = {
  ISS: "https://example.org/shc-wallet",
};

async function createVp(
  jws: string[],
  { nonce, client_id }: Pick<VP_Request, "nonce" | "client_id">
) {
  return new jose.UnsecuredJWT({
    nonce,
    vp: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiablePresentation"],
      verifiableCredential: jws,
    },
  })
    .setIssuer(serverConfig.ISS)
    .setAudience(client_id)
    .setIssuedAt()
    .setNotBefore("0min")
    .setJti(crypto.randomUUID())
    .setExpirationTime("5min")
    .encode();
}

interface ProviderConfiguration {
  authorization_endpoint: string;
  presentation_definition_uri_supported: boolean;
  issuer: string;
  scopes_supported: (
    | "https://smarthealth.cards/scope#insurance"
    | "https://smarthealth.cards/scope#covid-vaccine"
    | "https://smarthealth.cards/scope#covid-test"
  )[];
  response_types_supported: ["vp_token"] | ["id_token", "vp_token"];
  response_modes_supported: ("fragment" | "direct_post" | "query")[];
  vp_formats_supported: {
    jwt_vp_json: {
      alg_values_supported: ("none" | "ES256")[];
    };
    shc_vc: {
      alg_values_supported: ["ES256"];
    };
  };
}

interface Provider {
  name: string;
  configuration: ProviderConfiguration;
}

export class Client {
  constructor(public client_id: string) {}

  prepareToAuthorize(
    provider: Provider,
    scope: ProviderConfiguration["scopes_supported"]
  ) {
    const req: VP_Request = {
      client_id: this.client_id,
      redirect_uri: this.client_id,
      client_metadata: {
        vp_formats: {
          jwt_vp_json: { alg: ["none"] },
          shc_vc: {
            alg: ["ES256"],
          },
        },
      },
      scope: scope.join(" "),
      nonce: crypto.randomUUID(),
      response_type: "vp_token",
    };
    const qs = Object.fromEntries(
      Object.entries(req).map(([k, v]) => [
        k,
        typeof v === "object" ? JSON.stringify(v) : v,
      ])
    );
    return {
      req,
      url:
        provider.configuration.authorization_endpoint +
        "?" +
        queryString.stringify(qs),
    };
  }
}

let smartDemoProvider: Provider = {
  name: "SMART Demo Wallet",
  configuration: {
    issuer: serverConfig.ISS,
    authorization_endpoint: serverConfig.ISS + "/authorize",
    presentation_definition_uri_supported: false,
    response_modes_supported: ["fragment"],
    response_types_supported: ["vp_token"],
    scopes_supported: [
      "https://smarthealth.cards/scope#covid-test",
      "https://smarthealth.cards/scope#covid-vaccine",
      "https://smarthealth.cards/scope#insurance",
    ],
    vp_formats_supported: {
      jwt_vp_json: {
        alg_values_supported: ["none"],
      },
      shc_vc: {
        alg_values_supported: ["ES256"],
      },
    },
  },
};

let clientConfig = {
  BASE_URL: "http://localhost:8080",
};
let c = new Client(clientConfig.BASE_URL);
let a = c.prepareToAuthorize(smartDemoProvider, [
  "https://smarthealth.cards/scope#insurance",
]);
console.log(a.url);

type ManifestEntry = {
  shc: string;
  fhirVersion: string;
} & Pick<
  PresentationDefinition["input_descriptors"][number]["constraints"],
  "fhirBundleContains"
>;

let shcManifest: ManifestEntry[] = [
  {
    shc: "eyJ6aXAiOiJERUYiLCJhbGciOiJFUzI1NiIsImtpZCI6IjNLZmRnLVh3UC03Z1h5eXd0VWZVQUR3QnVtRE9QS01ReC1pRUxMMTFXOXMifQ.3ZJLj9MwFIX_yuiyzcPJPKJmR4vESyAQAxvUhevcNkaOHfkRtYzy37l2O-Kh6WwACZHdjY-Pz_nsO5DOQQu996Nry9KNKAo3cOt75Mr3heC2cyXu-TAqdCWpA1rIQG-20FY3TVOxy7puiqsMJgHtHfjDiNB-_u74q9mT45DHgYzO6-QwBC2_ci-NflQozCS7agHrDITFDrWXXH0Imy8ofIy07aX9hNZFnxauClZU5Bf_LoPuFEaNRWeCFXib4sNpITvVAWGUIrdjEjrAHqgjOQelPlpFgvv9LSPB_fCA8TuqQ_sjQT7g0YQPUpEfPNWksS6dsZMT6sjxlenjvCxgPVPBjaTyz7iPXtXiuspZldcM5jl7ME31eJqXPyN2nvvgUt143R7jBU1cCKlxZbrkIEwn9S4FdwfncTi9HrqZXjWFsbsyki2d7Eox7clApJ1Qswbm9ZzBeEKQ4mzRoo7ZfiRIIiNEsGkplr2Vw9GiToVZrEWotsYO9BpjFi68sdGyk25UPOFcri6eo0bL1cUL40bpuSJQBFEZ_zYMm7gVWPqqswTr_5JgvfjTBJuzBC__IYLU-_cJ1jlb5Oz6b7zBNUEEKzv6-eb1YbXvm_EmvKeFbw.E0-FV988NPiCzXrXdjFBILYtxw1V6OJMsuPfbQvpWxNjoiJ7csG6UiDZDorxexjYeh8Q37mlvqqRPXgl_MThKw",
    fhirVersion: "4.0.1",
    fhirBundleContains: [
      {
        resourceType: "Patient",
      },
      {
        resourceType: "Coverage",
      },
    ],
  },
];
function findManifestEntries(
  requirements: PresentationDefinition,
  manifest: ManifestEntry[]
) {
  const constraints = requirements.input_descriptors.map((d) => {
    let fhirVersionStrings =
      typeof d.constraints.fhirVersion === "string"
        ? [d.constraints.fhirVersion]
        : d.constraints.fhirVersion;
    let fhirVersions = fhirVersionStrings.map(
      (v) => new RegExp(v.replaceAll(".", ".").replaceAll("*", ".*"))
    );
    return {
      optional: d.constraints.optional,
      fhirVersions,
      fhirBundleContains: d.constraints.fhirBundleContains,
    };
  });

  return manifest.filter((e) =>
    constraints.every(
      (c) =>
        c.optional ||
        (c.fhirVersions.some((v) => e.fhirVersion.match(v)) &&
          c.fhirBundleContains.every((cBundleContains) =>
            e.fhirBundleContains.some(
              (eBundleContains) =>
                cBundleContains.resourceType === eBundleContains.resourceType &&
                (!cBundleContains.profile ||
                  cBundleContains.profile.some((cBundleProfile) =>
                    eBundleContains.profile?.some(
                      (eBundleProfile) => eBundleProfile === cBundleProfile
                    )
                  ))
            )
          ))
    )
  );
}

const aParsedRaw = queryString.parse(a.url.split("?")[1]) as Record<
  keyof VP_Request,
  string
>;

const aParsed = {
  ...aParsedRaw,
  presentation_definition:
    JSON.parse(aParsedRaw.presentation_definition || "null") || undefined,
  client_metadata: JSON.parse(aParsedRaw.client_metadata),
} as VP_Request;
if (aParsed.client_id !== aParsed.redirect_uri) {
  throw "client_id must match redirect_url for anonymous clients";
}

console.log("aParsed", aParsed);

let matchingCredentials = findManifestEntries(
  scopes[aParsed.scope!],
  shcManifest
);
console.log("Could use", matchingCredentials);
let vp = await createVp(
  matchingCredentials.map((c) => c.shc),
  {
    nonce: aParsed.nonce,
    client_id: aParsed.client_id,
  }
);

console.log("VP", vp);
